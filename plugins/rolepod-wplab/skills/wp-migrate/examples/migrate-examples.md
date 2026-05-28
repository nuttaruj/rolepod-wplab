# wp-migrate — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — migrating dev → prod, the confirm flow

### Bad

```text
User: "migrate dev.walnut.local to walnut.com"
Lead: migrate_dryrun, surfaces plan.
User: "looks good, go"
Lead: migrate_data immediately.
```

Issues: prod destination, single-word confirm, no backup, no type-back. If the user mistyped "go" for "go back", the production data is overwritten. Recovery = file an emergency restore ticket with the host.

### Good

```text
User: "migrate dev.walnut.local to walnut.com"

Lead:
1. wp-health-check both sides → both green.
2. wp-diagnose walnut.com (the prod dest) → 0 HIGH/CRITICAL.
3. migrate_dryrun → plan surfaces:
     - wp_options: 12 rows changed
     - wp_posts: 8 new posts to copy
     - URLs rewrite dev.walnut.local → walnut.com in 47 rows
   Production-matched: YES.

4. Tell user:
   "Destination walnut.com is production-matched. To proceed, please TYPE BACK
    the destination hostname exactly: walnut.com"

5. User: "walnut.com"

6. Lead: matches verbatim. Proceeds.

7. backup_create on walnut.com → file at
   ~/.config/rolepod-wplab/backups/walnut.com-2026-05-26T08-40-00.tar.gz
   surfaced to user. "Backup file saved. Type 'apply now' to continue."

8. User: "apply now"

9. migrate_data with plan_id from step 3.

10. wp-health-check → green. wp-diagnose → 0 NEW HIGH/CRITICAL.

11. Spot-check homepage, /blog, /wp-admin → all 200.

12. Surface: "Migrated. Backup at <path> for 30-day retention."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Pre-flight | none | both health + dest diagnose |
| Plan surfaced + acknowledged | no | yes |
| Production guard | bypassed | type-back hostname |
| Backup before apply | no | yes, path surfaced |
| Verification post-apply | no | health + diagnose + spot-check |
| Recovery path on failure | "ticket the host" | auto-rollback via backup_path |

## Scenario 2 — partial scope vs full migration

### Bad

```text
User: "I just want to copy the 3 new posts I wrote on dev to staging"
Lead: migrate_data with scope=full.
```

Issues: full scope copies db + wp-content. Staging users vanish (user table replaced). Staging plugins reset to dev's plugin set. 30+ unrelated rows changed.

### Good

```text
User: "I just want to copy the 3 new posts I wrote on dev to staging"

Lead: clarifies scope:
   "Three posts only? IDs 8, 12, 14? Confirm."

User: "yes, those three."

Lead: migrate_dryrun with scope=posts:[8,12,14].
   Plan shows: 3 posts + their attached media + their term relationships.
   12 rows changed (3 wp_posts + 4 wp_postmeta + 5 wp_term_relationships).
   wp_options unchanged. wp_users unchanged.

   Surface: "Plan is 12 row changes. Confirm?"

User: "go"

Lead: backup_create staging.
Lead: migrate_data with scope=posts:[8,12,14], plan_id from above.
Lead: spot-check the 3 posts render on staging → all 200.
Lead: surface "3 posts copied, staging otherwise unchanged."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Scope clarified | no | yes, 3 IDs |
| Plan size | huge (full) | small (12 rows) |
| Side effects on staging | many | zero |
| User mental model | "everything broken" | "exactly the 3 I asked for" |
