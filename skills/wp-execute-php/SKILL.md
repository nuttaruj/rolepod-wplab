---
name: wp-execute-php
description: Run a PHP payload inside the live WordPress request lifecycle via the companion plugin. Requires companion installed + ROLEPOD_WPLAB_PROFILE=power + target not production-matched + confirm:true.
---

## When to use

- A debugging or introspection task that genuinely needs PHP runtime context (active hooks at call time, plugin-internal cache, transients tied to current request, code paths only reachable inside `init` / `wp_loaded` / `template_redirect`).
- The user has installed `rolepod-wplab-companion`, set `ROLEPOD_WPLAB_PROFILE=power`, and target is not production-matched.

## When NOT to use

- Anything achievable via wp-cli or REST. Use `rolepod_wp_cli_run` / `rolepod_wp_rest_request` / a typed `wp_*` tool instead.
- Anything that mutates content. Use typed CRUD tools (`rolepod_wp_post_update`, etc.) so the operation is replayable + audit-trailed via tool schema.
- Anything on a production-matched target. Tool will refuse; do not retry with override (no override exists).
- When companion is not installed. Skill fails with a clear "install companion" hint.

## Requires companion?

yes — `rolepod-wplab-companion` installed on target + `ROLEPOD_WPLAB_PROFILE=power` + target not production-matched.

## Inputs

- `target_id` — connected WP target.
- `payload` — PHP source (no `<?php` tag). MUST pass AST screen: no `eval` / `system` / `shell_exec` / `exec` / `proc_open` / `popen` / `pcntl_*` / `dl` / backtick / dynamic include/require.
- `timeout_ms?` — default 5000, max 30000.
- `confirm: true` — REQUIRED literal. Surface the payload to the user before invoking.

## Outputs

- `ok`, `return_value`, `stdout`, `duration_ms`, `php_warnings[]`, `audit_id`.

## Process

1. Verify companion handshake + power profile + non-prod target. If any missing, abort with diagnostic — do not retry.
2. Show payload to user, wait for explicit confirmation.
3. Construct `rolepod_wp_execute_php` input with `confirm: true`.
4. Call tool. Surface `audit_id` + result. Log entry on disk is permanent.

## If the tool is unavailable

Cause is one of:
- Companion not installed → install from https://github.com/nuttaruj/rolepod-wplab-companion/releases
- `power` profile not set → `export ROLEPOD_WPLAB_PROFILE=power` and restart MCP
- Target is production-matched → intentional; no override exists. Use `/wp-scaffold-*` or wp-cli direct on production after manual review.

Run `rolepod-wplab doctor` for a full diagnostic.

## Examples

```
User: "debug why 'init' hook fires twice"
Lead → verify companion handshake (rolepod_wp_health_check → companion_ok: true)
Lead → show payload: "global $wp_filter; return count($wp_filter['init']->callbacks);"
User confirms
Lead → rolepod_wp_execute_php { target_id, payload, confirm: true }
        → { return_value: 47, audit_id: "wplab_audit_4a2b1f" }
Lead reply: "47 callbacks registered on init. Audit: wplab_audit_4a2b1f."
```
