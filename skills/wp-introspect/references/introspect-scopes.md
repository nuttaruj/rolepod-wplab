# Introspect scopes — when to pick what

## hooks

**Returns:** map of `hook_name → [{ priority, callback_identifier }]` for every action + filter currently registered.

**Pick when:**
- "Why isn't `save_post` firing my callback?" — verify your priority + identifier appear.
- "What plugins listen on `wp_head`?" — enumerate.
- "Did my plugin register its hook on activation?" — confirm post-activation.

**Pitfalls:**
- Output is large (often 80+ KB even on a fresh install) — do not print everything to the user; filter by hook name first.
- `callback_identifier` collapses closures to `Closure@<file>:<line>`. Anonymous functions cannot be matched by name.
- Priority sort is ascending; same priority = registration order (use `hook_state` for fine-grained order).

## transients

**Returns:** list of `{ name, size_bytes }` for every transient currently stored.

**Pick when:**
- "Is the cache warm?" — check expected transient names exist.
- "Which transients are bloating the options table?" — sort by `size_bytes`.
- "Why is the homepage slow?" — look for missing common-page-cache transients.

**Pitfalls:**
- Names only by default. To see VALUES, pass `include_values: true` (refused on production).
- Site transients (`_site_transient_*`) are multisite-scoped; single-site shows them as regular transients.

## options_full

**Returns:** list of `{ name, autoload, size_bytes }` for EVERY row in `wp_options`.

**Pick when:**
- "Which options is plugin X storing?" — filter by prefix.
- "What's bloating autoload?" — sort by `autoload=yes` + size.
- "Did the option I just set persist?" — verify post-write.

**Pitfalls:**
- Largest scope by output size; sites with WooCommerce / Yoast / Polylang routinely have 800+ option rows.
- `autoload=yes` rows load on EVERY request — large ones (>50 KB) are perf hot spots.
- Same as transients: values hidden by default.

## request_state

**Returns:** `{ request: { method, uri, user_id, has_get_params, has_post_params }, wp: { is_admin, doing_rest, doing_cron, doing_ajax } }`.

**Pick when:**
- "Is this running in REST context?" — `doing_rest`.
- "Is this a cron request?" — `doing_cron`.
- "Who is the current user?" — `user_id`.
- "What request triggered this introspect?" — meta-debugging.

**Pitfalls:**
- Each introspect call is itself a REST request → `doing_rest: true` always, `is_admin: false` always (since REST runs outside admin context).
- Useful when paired with `hook_state` to confirm callback fires only in the right context.

## hook_state (separate tool)

**Returns:** for ONE hook name, the full callback list with priority + callable shape (function name OR class::method OR Closure marker).

**Pick when:**
- "Show me every callback on `init`, in order."
- "Verify the order of two competing callbacks on `the_content`."
- "Confirm my filter is registered at priority X and not Y."

**Pitfalls:**
- Companion-only (same as introspect).
- A hook with 0 callbacks returns an empty array — that itself is the answer to "is the hook listened to".

## Combining scopes

A typical debug session uses 2-3 scopes in sequence:

```
1. hook_state { hook: "woocommerce_checkout_order_processed" }
   → see which plugins listen.

2. options_full (filter by "woocommerce_")
   → see which Woo options affect that flow.

3. transients
   → see if Woo's checkout cache is hot.
```

Do NOT use `wp-execute-php` to read state — `introspect` is faster, safer, audit-logged separately.
