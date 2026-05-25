---
name: wp-introspect
description: Snapshot WordPress runtime context (hooks, transients, options, request state) via the companion endpoint. Read-only, no eval.
---

## When to use

- Debugging "why isn't this hook firing?" / "what's in this transient right now?"
- Auditing plugin behavior without modifying state.
- Before invoking `/wp-execute-php` to verify the runtime is in the expected state.

## When NOT to use

- For data you can get from wp-cli (`wp option get`, `wp transient get`). Use those — faster, no companion required.
- For mutation. Use a typed write tool instead.

## Requires companion?

yes — `rolepod-wplab-companion` installed on target.

## Inputs

- `target_id`.
- `scope` — `hooks` | `transients` | `options_full` | `request_state`.
- `include_values?` — only effective on non-prod targets (default false).

## Outputs

- `scope`, `report` (shape varies by scope).

## Process

1. Verify companion handshake.
2. Call `rolepod_wp_introspect { target_id, scope }`.
3. Surface key findings inline; if `report` is large, save to disk and reference path.

## If the tool is unavailable

Companion not installed; install from companion releases page. Same flow as `/wp-execute-php`.

## Examples

```
User: "what hooks fire on init?"
Lead → rolepod_wp_hook_state { target_id, hook: "init" }
       → callbacks: [{ priority: 10, callback_identifier: "..." }, ...]
Lead reply: "47 callbacks on init, top 5 by priority: ..."
```
