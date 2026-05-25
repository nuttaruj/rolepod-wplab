---
name: wp-migrate-dryrun
description: Compute a migration plan between two WP targets without applying any changes. Useful for diffing dev → staging → prod.
---

## When to use

- Plan a migration between environments (e.g. staging → prod) without committing changes.
- Pre-deploy diff to surface plugin version mismatches, missing options, role drift.
- Sanity-check that two environments are aligned after a refactor.

## When NOT to use

- One-way data sync (use a dedicated migration plugin like WP Migrate / Duplicator for actual data transfer).
- Tiny single-table copy (use `rolepod_wp_db_query` directly).

## Inputs

- `source_target_id` — connected source target.
- `dest_target_id` — connected destination target.
- `scope[]` — any of: `plugin_versions`, `options`, `users`, `posts`. Default: `[plugin_versions]`.

## Outputs

- `plan` — structured diff per scope.
- `plan_path` — markdown/json artifact under `./.rolepod-wplab/artifacts/<run_id>/migration-plan.json`.

## Process

1. Verify both targets are connected (call `rolepod_wp_health_check` on each).
2. Call `rolepod_wp_migrate_dryrun { source_target_id, dest_target_id, scope }`.
3. Surface key diffs inline (e.g. "5 plugin version mismatches, 12 options only on source").
4. Reference plan_path for full detail.

## If the tool is unavailable

Same handling as other shipped skills.

## Examples

```
User: "diff dev vs staging"
Lead → rolepod_wp_connect_local { path: "..." }   (already connected)
Lead → rolepod_wp_connect_rest { url: "https://staging.client.com" }
Lead → rolepod_wp_migrate_dryrun { source_target_id, dest_target_id, scope: ["plugin_versions","users"] }
       → plan_path: "./.rolepod-wplab/artifacts/wplab_.../migration-plan.json"
Lead reply: "Plugin diff: WooCommerce on dev 9.4, staging 9.2 — upgrade staging first. Users: 1 admin on dev not on staging."
```
