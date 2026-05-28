---
name: wp-introspect
description: Read-only runtime snapshot of WordPress internals via the companion's `/introspect` endpoint — hooks, transients, options, request_state, hook callbacks. Phase = Debug.
when_to_use: user is debugging a hook firing order / transient stuck / option value mystery / "who is listening to this filter", OR wants to inspect runtime state without writing
tier: 1
phase: debug
---

# WP Introspect

Read-only runtime visibility into WordPress. Covers four scopes via the companion `/introspect` endpoint plus `hook_state` for callback enumeration. Pure read — never writes, never evaluates code (that is `wp-execute-php`).

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER set `include_values: true` on production-matched siteurl — option/transient values may contain API keys, third-party tokens, or PII; the production guard fires server-side but client should self-gate first.
2. NEVER call `introspect` repeatedly in a tight loop — every call is a full PHP request; for repeated polling use `request-observer` instead (see `references/introspect-scopes.md`).
3. ALWAYS pair the right scope to the question — `hooks` answers "who is listening", `options_full` answers "what is stored", `transients` answers "what is cached", `request_state` answers "what's the current request"; using `options_full` for a hook question wastes context.
</EXTREMELY-IMPORTANT>

## When to use

- "Why is filter X not firing?" → `hooks` scope + `hook_state` on that hook.
- "Why is the transient cache cold?" → `transients` scope.
- "What option does plugin X store?" → `options_full` (names only, then targeted lookup).
- "What's the current request lifecycle state?" → `request_state`.

Skip when:
- The question needs PHP-level mutation (run a function, set a variable) → `wp-execute-php`.
- The question is a multi-probe diagnostic (slow queries + plugin conflicts + PHP errors) → `wp-diagnose`.
- The question is post/page content → core REST via `wp-content`.

## Boundary

Owns:
- `rolepod_wp_introspect` (all 4 scopes).
- `rolepod_wp_hook_state` (specific hook → callbacks listed).
- Read-only access to the companion `/introspect` endpoint.

Does not own:
- Mutation of any runtime state → `wp-execute-php` (with safety chain).
- Analysis / ranking / report (turning raw introspect data into ranked findings) → `wp-diagnose`.
- File-level reads → `file_read`.

Return / hand off:
- Question requires writing → `wp-execute-php`.
- Question requires CPU-deep probe (slow queries, php_errors) → `wp-diagnose`.

## Inputs to gather

- target_id.
- `scope` (hooks / transients / options_full / request_state).
- `include_values: true` ONLY on non-production targets, and only with explicit user OK.
- For `hook_state`: the hook name (e.g. `wp_head`, `save_post`, `woocommerce_checkout_order_processed`).

## Workflow

### 1. Pick the scope

See `references/introspect-scopes.md` for the per-scope decision tree.

### 2. Call

Single `rolepod_wp_introspect { target_id, scope, include_values? }` OR `rolepod_wp_hook_state { target_id, hook }`.

### 3. Surface

Print the result raw. Do not summarize. The user is debugging — they need verbatim.

### 4. Hand off if needed

If the introspect reveals a problem worth diagnosing in depth → `wp-diagnose`. If it reveals a fix that needs runtime PHP → `wp-execute-php`.

## If a matching Rolepod agent is available

- `rolepod:debug-issue` (Rolepod parent skill) for the broader debug workflow this introspect feeds into.
- `rolepod:backend-developer` for hook-callback investigation.

## If no matching agent is available

1. Pick the scope.
2. Call.
3. Surface verbatim.
4. Suggest the next phase if the result requires action.

## Output

No durable artifact. The introspect response is the value — surface it directly.

## Examples

No examples file. The four scopes are documented in references with concrete inputs/outputs.

## References

Load when picking a scope or when an introspect result is unfamiliar:
- `references/introspect-scopes.md` — per-scope decision tree, sample output shape, common pitfalls (transients with sub-resources, options_full size, hook priority sort, request_state during REST vs admin-ajax).

## Hard stops

- `include_values: true` AND target is production-matched → STOP, refuse client-side, do not pass to server (server would refuse too but the request leaks intent).
- Companion not installed → STOP, hand off to user with companion install URL.
- Scope mistyped (not in {hooks, transients, options_full, request_state}) → STOP, surface the schema error.

## Full Rolepod enhancement

Full Rolepod adds historical introspect diffing (compare today's hook map to yesterday's) using per-site `~/.config/rolepod-wplab/memory/`. Standalone, each call is point-in-time.

## Next phase

- Result + intent to fix → `wp-execute-php` (PHP eval) OR `wp-content` (REST write) OR `wp-edit-plugin` (plugin config).
- Result is concerning → `wp-diagnose` for the full multi-probe view.
- Result is benign → done.
