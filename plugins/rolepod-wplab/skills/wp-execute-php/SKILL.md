---
name: wp-execute-php
description: Run a PHP payload inside the live WordPress request lifecycle via the companion endpoint. Phase = Power. Requires companion + ROLEPOD_WPLAB_PROFILE=power + non-production target + AST-clean payload + confirm:true.
when_to_use: a problem CANNOT be solved by core REST + adapter REST + wp-cli + introspect — needs direct PHP runtime access (object instantiation, hook dispatch test, transient set, internal API call)
tier: 1
phase: power
---

# WP Execute PHP

Last-resort power tool. Bypasses every safer layer (REST, wp-cli, introspect) to run arbitrary PHP in the WP request lifecycle. Five-layer safety chain. Audit-logged. Production-blocked unconditionally.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER call `rolepod_wp_execute_php` if the same outcome is reachable through `wp-content` (REST), `wp-edit-plugin` (adapter REST), `wp-introspect` (read), or `wp-execute-php`'s sibling `wp_cli_run`. Power tool = last resort.
2. NEVER pass `confirm: true` automatically on the user's behalf — the flag exists so the user accepts personal responsibility for the payload; auto-confirming defeats it.
3. ALWAYS read the AST blocklist in `references/ast-rules.md` before composing a payload. `eval`, `system`, `shell_exec`, `proc_open`, `popen`, dynamic include, out-of-scope file ops, pcntl_*, dl, backtick — all are forbidden on both sides and the screen catches them up front.
</EXTREMELY-IMPORTANT>

## When to use

- "Fire `do_action('save_post', 42)` and observe what happens" — runtime hook trigger.
- "Instantiate WC_Order(123) and dump its meta" — internal API call.
- "Set a transient programmatically for testing" — read/write the cache layer.
- "Run `wp_schedule_event` to register a cron" — internal scheduler call.
- Any case where REST/wp-cli/adapter does not expose the surface and a small PHP snippet is the cleanest fix.

Skip when:
- The work is post/option/user → `wp-content`.
- The work is a plugin's config → `wp-edit-plugin`.
- The work is "just look at state" → `wp-introspect`.
- The work is a wp-cli command → call `wp_cli_run` (companion's wp-cli endpoint via the same bridge, no need for execute-php).

## Boundary

Owns:
- `rolepod_wp_execute_php` with the full safety chain.
- AST screen interpretation (Node side, mirrored on companion side).
- Production guard surfacing.
- Audit-id reporting to user.

Does not own:
- Any non-power workflow — those go to their own skill.
- wp-cli — even though wp-cli routes through companion now, that's `wp_cli_run` not `execute_php`.

Return / hand off:
- AST screen rejected the payload → go back to the user with the specific forbidden token; do not "work around" by encoding/obfuscation.
- Power profile not set → hand off to user: "set `ROLEPOD_WPLAB_PROFILE=power` env and reconnect."
- Production-matched siteurl → STOP. There is no override path. Tell user to use a non-prod target.

## Inputs to gather

- target_id.
- `payload` (the PHP snippet).
- `confirm: true` (mandatory).
- `timeout_ms` (default 5000).

## Workflow

### 1. Justify the power tool

State why no safer skill solves this. If you cannot answer in one sentence → STOP, use the safer skill.

### 2. AST pre-screen mentally

Check the payload against `references/ast-rules.md`. If any forbidden token appears → STOP, rewrite without it.

### 3. Confirm preconditions

- `ROLEPOD_WPLAB_PROFILE=power` env present.
- Target not production-matched.
- User explicitly OK'd `confirm: true`.

### 4. Run

`rolepod_wp_execute_php { target_id, payload, confirm: true, timeout_ms? }`. The call returns `return_value`, `stdout`, `php_warnings`, `duration_ms`, `audit_id`.

### 5. Surface

State the return_value, php_warnings count, duration, audit_id. The audit_id is the user's reference if anything went wrong server-side.

## If a matching Rolepod agent is available

- `rolepod:debug-issue` for the broader debug context this fits into.
- `rolepod:backend-developer` for PHP-level investigation.

## If no matching agent is available

1. Justify in one sentence why power tool.
2. Pre-screen payload against AST rules.
3. Confirm prereqs.
4. Run with `confirm: true`.
5. Surface result + audit_id.

## Output

No durable artifact in the MCP. The companion writes an audit entry under `wp-content/uploads/rolepod-wp-audit/<audit_id>.log` (mode 0600) AND a row in `wp_options.rolepod_wp_audit_log`. The user owns the audit trail.

## Examples

Read EVERY time before composing a new payload — the good/bad contrast catches the most common attack-surface mistakes:
- `examples/php-examples.md` — good vs bad payloads for a transient set + for a runtime hook dispatch.

## References

Load when composing the FIRST payload of a session, or when the AST screen rejects something:
- `references/ast-rules.md` — the full forbidden-token list, the reason for each, the alternative if one exists.

## Hard stops

- AST screen rejects (Node OR PHP side) → STOP, surface `AST_REJECTED` with the forbidden token; do not retry with obfuscation.
- `POWER_PROFILE_REQUIRED` → STOP, user must set env + reconnect.
- `PRODUCTION_BLOCKED` → STOP, no override.
- `confirm: true` missing → STOP, ask user.
- Payload size > 100 KB → STOP, refactor into smaller calls or use `wp_cli_run` for file-level ops.

## Full Rolepod enhancement

Full Rolepod adds session-token-aware persistent eval (php_session endpoint) for multi-call scripts that share variables. Standalone, each execute-php call is independent.

## Next phase

- Result is data → use it as input to the next skill (e.g. found IDs → `wp-content` to update).
- Result is a side effect (transient set, hook fired) → `wp-health-check` to confirm the system stayed healthy.
- Result is failure → `wp-diagnose` for the broader picture.
