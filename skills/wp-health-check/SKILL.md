---
name: wp-health-check
description: Return a lightweight diagnostic of a WordPress target — versions, DB connectivity, REST reachability, active plugins/theme, companion presence, warnings.
---

## When to use

- After installing rolepod-wplab to confirm a target connects.
- Inside `check-work` workflow to provide WP-context evidence.
- Before invoking other wplab tools to confirm the target is reachable.
- After any wp-cli / REST change to verify nothing broke.

## When NOT to use

- For deep performance profiling. Use APM tools (New Relic, Query Monitor inside WP).
- For security audits — use `/wp-audit-security` instead.

## Inputs

- `target_id` — connected WP target (from `rolepod_wp_connect_local` or `rolepod_wp_connect_rest`).

## Outputs

- `wp_version`, `php_version`, `db_ok`, `wp_cli_ok`, `rest_ok`, `companion_ok`, `site_url`, `warnings[]`.

## Process

1. Call `rolepod_wp_health_check { target_id }`.
2. Surface any `warnings[]` prominently — they often indicate misconfig the user can fix in 1 minute.
3. If `companion_ok=false` but the user wants power tools, hint at companion install.

## If the tool is unavailable

The rolepod-wplab MCP server is not registered or is not responding.

- Confirm the plugin is installed: `claude plugin list | grep wplab` (or analogue for Cursor / Codex / Gemini).
- Run `rolepod-wplab doctor` to diagnose.

Do NOT attempt the work via wp-cli direct, a third-party plugin, or any other backend.

## Examples

```
User: "WP health"
Lead → rolepod_wp_health_check { target_id: "tgt_8585f975d001" }
Lead reply: "WP 6.6.2 / PHP 8.2.10
              ✓ db_ok, wp_cli_ok, rest_ok
              ✗ companion_ok=false (install companion for power tools)
              warnings: REST check deferred to v0.1"
```
