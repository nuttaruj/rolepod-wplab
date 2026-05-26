---
name: wp-migrate
description: Plan, dry-run, apply, back up, and clone migrations between two WP targets — dev → staging → prod, with rollback. Phase = Ship.
when_to_use: user wants to move a site (or a subset of content) between environments, OR back up before a risky change, OR clone a site for testing
tier: 1
phase: ship
---

# WP Migrate

End-to-end migration workflow. Owns dryrun, apply, backup, restore, clone. The HARDEST safety surface in the toolkit — every step is destructive at production scale. Walks a plan → backup → apply → verify → rollback ladder.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER apply a migration without running `migrate_dryrun` first AND surfacing the plan to the user for explicit OK — apply is irreversible at scale.
2. NEVER apply without `backup_create` on the destination first — the only reliable rollback is the destination backup, taken IMMEDIATELY before apply, archived locally.
3. NEVER set destination to production-matched siteurl without `confirm_production: true` AND the user typing back the destination hostname verbatim — most production data loss starts with a fast "yes, go" reply.
</EXTREMELY-IMPORTANT>

## When to use

- "Move dev to staging"
- "Sync the latest plugin set from dev to prod"
- "Clone walnut.local to a new sandbox site"
- "Back this up before I install a risky plugin"
- "Roll back last week's migration"

Skip when:
- The change is content-only (a few posts) → `wp-content` REST CRUD.
- The change is a single plugin's config → `wp-edit-plugin`.

## Boundary

Owns:
- `rolepod_wp_migrate_dryrun` — compute the plan without applying.
- `rolepod_wp_migrate_data` — apply the plan.
- `rolepod_wp_backup_create` — pre-apply backup of destination.
- `rolepod_wp_backup_restore` — rollback path.
- `rolepod_wp_clone` — full-site copy (db + wp-content + URL rewrite).

Does not own:
- DNS / SSL / domain switch — those are hosting-panel tasks, out of MCP scope.
- Content-level edits → `wp-content`.
- Pre-migration security audit → `wp-diagnose`.

Return / hand off:
- Plan reveals incompatible PHP version on destination → STOP, hand off to user with the version mismatch.
- Apply fails partway → backup_restore + surface the failure.
- After successful apply → `wp-health-check` + `wp-diagnose` to confirm.

## Inputs to gather

- `source_target_id` + `dest_target_id`.
- Scope: full site / db only / wp-content only / specific tables / specific posts.
- For prod destinations: `confirm_production: true` + the user re-typing the destination hostname.

## Workflow

### 1. Pre-flight on BOTH targets

- `wp-health-check` source.
- `wp-health-check` destination.
- `wp-diagnose` destination (any HIGH findings = STOP, fix first).

### 2. Dry-run

`rolepod_wp_migrate_dryrun { source_target_id, dest_target_id, scope }`. Output: per `templates/migrate-plan.md`. Surfaces row counts, file counts, table conflicts, URL rewrites required.

### 3. Confirm with user

Show the plan, ask for explicit OK. If destination is production-matched:
- Ask user to type back the destination hostname literally.
- Match must be exact, case-sensitive.
- Refuse to proceed otherwise.

### 4. Backup destination

`rolepod_wp_backup_create { target_id: dest_target_id }`. Surface the backup file path. The user keeps this; if anything goes wrong, rollback uses this.

### 5. Apply

`rolepod_wp_migrate_data { source_target_id, dest_target_id, scope, plan_id: <from dryrun> }`. The `plan_id` ties apply to the dryrun — a fresh dryrun is required if more than 5 minutes elapsed.

### 6. Verify

- `wp-health-check` destination → all green.
- `wp-diagnose` destination → no NEW critical findings vs the pre-migration report.
- Spot-check 3 user-visible URLs (homepage, a known post, login page).

### 7. Surface result

State: rows migrated, files copied, URLs rewritten, backup file path, verification result.

### 8. Rollback (only if needed)

If verification fails: `rolepod_wp_backup_restore { target_id: dest_target_id, backup_path: <from step 4> }`. Surface restored state.

## If a matching Rolepod agent is available

- `rolepod:devops-sre` for the full ship gate.
- `rolepod:security-engineer` for the pre-flight + post-flight audit pass.

## If no matching agent is available

1. Pre-flight both.
2. Dryrun.
3. Confirm with user (prod = type-back hostname).
4. Backup destination.
5. Apply.
6. Verify.
7. Surface OR rollback.

## Output

Migration plan — `templates/migrate-plan.md`. Persists per run at `./.rolepod-wplab/artifacts/<run_id>/migrate-plan.md`.

## Examples

Read before EVERY production-destination migration — the type-back hostname pattern is in here:
- `examples/migrate-examples.md` — good vs bad confirm flow for prod destination; good vs bad scope picking for a partial migration.

## References

Inline only. The plan format is the template. The backup file format is companion-side (gzipped SQL + wp-content tar).

## Hard stops

- Destination is production-matched AND user did not type back the hostname → STOP, do not apply.
- Dryrun reveals table-shape mismatch (source has table X, destination missing it) → STOP, surface, ask user.
- backup_create fails → STOP, do not apply without backup.
- Post-apply verification fails → AUTO-ROLLBACK via backup_restore, do not ask first; then surface what happened.
- More than 5 minutes between dryrun and apply → re-run dryrun.

## Full Rolepod enhancement

Full Rolepod adds multi-environment graphs (dev → staging → prod chained migrations, with rollback to any prior known-good checkpoint). Standalone, the user runs the sequence by hand.

## Next phase

- Success → `wp-health-check` periodically + `wp-diagnose` weekly.
- Rollback ran → `wp-diagnose` to identify why apply failed.
- Apply for prod → tell user to verify DNS / SSL / cache layer (hosting-panel scope, not MCP).
