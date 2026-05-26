# AST screen — forbidden tokens

Both the Node side (pre-send) and the companion side (post-receive, via `nikic/php-parser` in companion v0.3+ / token-blocklist before that) reject payloads containing these tokens. The reasons + alternatives are below.

## Hard-blocked tokens

| Token | Reason | Alternative |
|---|---|---|
| `eval` | Recursive code execution outside the AST screen's view. | Just write the code directly in the payload — eval'ing a string defeats the screen. |
| `assert` | Same as eval (assert with a string runs eval). | Use assert with a boolean expression, or don't assert in user code. |
| `create_function` | Lambda from string source (deprecated PHP 7.2+, removed PHP 8). | Use real closures. |
| `system` | Shell out — escapes WP scope. | Use `wp_cli_run` (companion's wp-cli endpoint) instead. |
| `passthru` | Shell out + raw output passthrough. | Same as `system`. |
| `shell_exec` | Shell out via backticks-equivalent. | Same as `system`. |
| `exec` | Shell out. | Same as `system`. |
| `proc_open` | Process spawn. | Same as `system`. |
| `popen` | Process pipe. | Same as `system`. |
| `pcntl_*` (any) | Process control / forks. | Out of scope; if you need parallelism, use wp-cron + scheduled events. |
| `dl` | Dynamic extension load. | Out of scope; load extensions via php.ini. |
| `` ` ` `` (backticks) | Shell-exec syntax. | Same as `system`. |
| `include`/`require` with dynamic expression | Unscanned file include = AST screen bypass. | Use literal-string paths only (still subject to scope guard). |

## File-op tokens (scoped-block)

These are allowed inside `wp-content/{themes,plugins,uploads}` and `wp-config.php` only:

| Token | Allowed under | Notes |
|---|---|---|
| `file_get_contents` | scoped path | absolute paths checked against scope |
| `file_put_contents` | scoped path | same; backup auto-created |
| `fopen`/`fread`/`fwrite`/`fclose` | scoped path | streams confined |
| `unlink` | scoped path | requires explicit user confirm in non-dryrun |
| `rename` | scoped path | both src + dst checked |

Out-of-scope paths → companion-side `FS_SCOPE_VIOLATION`.

## Recommended payload patterns

### Read a transient
```php
return get_transient('my_transient_name');
```
✓ Pure read. No screen issues.

### Write a transient
```php
return set_transient('my_transient_name', 'value', 3600);
```
✓ Single WP API call. No issues.

### Fire a hook for testing
```php
do_action('save_post', 42, get_post(42), false);
return 'fired';
```
✓ Internal API. No issues.

### Instantiate a class
```php
$order = new WC_Order(123);
return $order->get_total();
```
✓ Direct API access. No issues.

### Set an option
```php
update_option('my_plugin_x_setting', 'new_value');
return get_option('my_plugin_x_setting');
```
✓ Better via `wp-content` `option_set`, but execute-php works when REST endpoint doesn't expose the option.

### NOT allowed

```php
eval("return 1;");          // eval is blocked
system('ls -la');           // system blocked
$file = $_GET['file'];      // not blocked but $_GET unavailable; use $req parameter
include $dynamic_path;      // dynamic include blocked
```

## What the AST screen does NOT catch

- Logic bugs (infinite loops → caught by timeout_ms).
- Memory leaks (caught by PHP memory_limit).
- Data corruption (`update_option` to wrong value — no automatic check; the screen does not understand semantics).
- Side effects on third-party APIs (curl calls, email sends — `wp_remote_*` works and is not screened).

The screen is an attack-surface filter, not a correctness filter. The user is responsible for what their payload does semantically.

## When the screen is overzealous

If a token in the blocklist is fundamental to the legitimate operation, the answer is: do not use execute-php for that operation. Use:
- `wp_cli_run` for shell-style ops.
- `wp-edit-plugin` for plugin-managed state.
- `file_write` for filesystem (scope-checked).

Bypass attempts (encoding the forbidden token to slip past the screen) trip the companion-side re-parse with `nikic/php-parser` and audit the rejection — meaning the user's account is flagged.
