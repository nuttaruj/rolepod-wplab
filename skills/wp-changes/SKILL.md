---
name: wp-changes
description: Query the AI Change Ledger on a connected target — every write the MCP issued, categorized; toggle on/off; panic-revert recent changes. Phase = Recovery.
when_to_use: site broke after AI activity ("ตอบ tool หลังเปิด AI แล้วเว็บพัง"), OR user wants to audit "อะไรที่ AI แก้ไปบ้างวันนี้", OR debug a regression by bisecting AI changes, OR roll back a single AI write without affecting others
tier: 1
phase: recovery
---

# WP Changes

The rollback skill. Every write the MCP issued through companion v2.3+ is captured in the Change Ledger (categorized, before+after state, applied flag). This skill queries that ledger, toggles individual rows, runs git-bisect-style binary narrowing, and panic-disables every change in a time window when the site is on fire.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER panic-revert without first running `wp-health-check` to confirm the site is actually broken — panic disables real production changes; using it as a "I'm curious" tool causes user-visible regressions.
2. NEVER toggle a row with `reversible: 0` and expect the side effect to undo — execute_php side effects and wp-cli destructive ops are flagged irreversible at record time; the toggle flips the flag but cannot replay the inverse. Surface this verbatim.
3. ALWAYS surface `target_descriptor` + `source_tool` when listing changes — user needs to recognize what each row IS, not just an opaque ID.
</EXTREMELY-IMPORTANT>

## When to use

- "เว็บพังหลัง AI แก้ของ" — panic + bisect flow.
- "What did AI do in the last hour?" — query with `since_minutes: 60`.
- "Undo only the last theme.json change, keep the rest" — single toggle.
- "Re-enable the changes I disabled earlier" — bulk toggle.
- Pre-migration: query ledger to know what changed before you snapshot.

Skip when:
- The site is up + user has no complaint → no need to touch ledger.
- Plain "is it up" → `wp-health-check`.
- Multi-probe diagnosis → `wp-diagnose`.

## Boundary

Owns:
- `rolepod_wp_changes_query` — filter the ledger.
- `rolepod_wp_changes_toggle` — single on/off.
- `rolepod_wp_changes_toggle_bulk` — batch on/off (used for bisect).
- `rolepod_wp_changes_panic` — disable all in window.
- The bisect workflow (re-enable batches, narrow down the bad row).

Does not own:
- Recording changes — that is automatic in writer tools (wp-content, wp-edit-*, wp-scaffold).
- Health/diagnostic probe → `wp-health-check` / `wp-diagnose`.
- Per-category revert semantics — those live in companion `Toggler.php`.

Return / hand off:
- After panic + recovery → `wp-diagnose` to understand WHY the change broke things, before re-enabling anything.
- User wants to permanently delete changes (not just toggle off) → admin UI → "Delete row" (not yet a MCP tool; defer to v1.7).

## Inputs to gather

- target_id (always).
- For query: filters (`category`, `applied`, `since_minutes`, `source_session`, `limit`).
- For toggle: `id` + new `applied` boolean.
- For bulk toggle: `ids` array + `applied`.
- For panic: `since_minutes` (1-1440).

## Workflow

### 1. Establish baseline

If the user reports "site broke", first: `wp-health-check`. If green, the site isn't broken — re-confirm with user before doing anything destructive.

### 2. Find the candidate changes

```
rolepod_wp_changes_query {
  target_id,
  applied: true,
  since_minutes: <last known good minutes ago>,
  limit: 50
}
```

The result is the list of changes that could have caused the breakage.

### 3. Triage

If 1-3 changes since last green → toggle off individually, verify after each.

If >3 changes → use panic + bisect:

```
rolepod_wp_changes_panic { target_id, since_minutes: 30 }
  → returns disabled_ids: [N..M]

wp-health-check → green (recovered).

Then bisect: re-enable half, check health.
  rolepod_wp_changes_toggle_bulk { ids: [first half of disabled_ids], applied: true }
  wp-health-check → if red, bad row is in first half; else in second half.

Narrow to single bad row. Leave it disabled. Surface to user.
```

### 4. Surface

For every toggle action, surface: id + category/subcategory + side-effect detail + new applied state. The user must SEE what the system did.

## If a matching Rolepod agent is available

- `rolepod:debug-issue` for the broader debug context this rollback fits into.
- `rolepod:devops-sre` for prod-recovery flows.

## If no matching agent is available

1. Baseline (wp-health-check).
2. Query candidates (since_minutes).
3. If few → toggle individually with verify after each.
4. If many → panic + bisect.
5. Leave bad row(s) disabled, surface to user, hand off to wp-diagnose.

## Output

No durable artifact in MCP. The companion's ledger row persists with `toggled_at` timestamp; the admin UI surfaces every toggle as a notice.

## Examples

Read EVERY time the user reports a broken site after AI activity — the bisect pattern is the heart of the recovery workflow:
- `examples/changes-examples.md` — good vs bad panic flow; good vs bad bisect narrowing.

## References

Inline only. The ledger schema + per-category toggle semantics live in companion `src/Audit/{ChangeLedger,ChangeRecorder,Toggler}.php`.

## Hard stops

- `wp-health-check` returns green AND user says "site broke" → STOP, do not toggle anything; ask user what they actually see broken.
- A toggle returns `side_effect.ok: false` AND `reversible: 0` → STOP, surface the limitation; do not retry.
- Bisect lands on >1 candidate as "bad" → STOP, both rows interact; surface to user, do not auto-toggle further.

## Full Rolepod enhancement

Full Rolepod adds session correlation — every AI session gets a `source_session` id, so `changes_query { source_session: '<sess>' }` retrieves exactly the work from one chat. Standalone, the user filters by `since_minutes`.

## Next phase

- After recovery → `wp-diagnose` to find WHY the bad change broke things.
- After bisect identifies the bad row → fix it (re-edit via the right edit skill, then re-enable a cleaner version).
- After permanent revert decisions → admin UI to delete rows (manual, no MCP tool yet).
