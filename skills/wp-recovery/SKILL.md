---
name: wp-recovery
description: Recover a WordPress site that is white-screening / 500-ing / fatal after an edit — guardian mu-plugin, safe-mode, disable/restore the culprit — plus safe core/plugin/theme updates and guarded .htaccess edits. Phase = Recover.
when_to_use: the site returns a 500 / white screen / fatal error (often right after a plugin activation, theme switch, functions.php or .htaccess edit), OR a 500 is confined to ONE surface while the rest of the site answers 200 (REST only, admin-ajax only, a single admin screen) — that is still a fatal and the guardian recorded it, OR the user wants to update core/plugins/themes or edit .htaccess with an automatic safety net
tier: 1
phase: recover
---

# WP Recovery

Get a broken site back up, then keep it up through risky maintenance. The
guardian mu-plugin (shipped with the rolepod-wp companion) loads BEFORE normal
plugins, survives a plugin/theme parse error, and records the fatal — so the
recovery endpoints stay reachable even when the front end is dead.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. On a live fatal, turn on `rolepod_wp_recovery_safe_mode(enabled: true)` FIRST — it fail-closes every mutating write in the companion namespace (execute-php, fs-write/-batch/-copy/-rename, option-set, elementor, skills, dir-ensure, backup-restore/-delete, changes-panic/-toggle, job-create, one-time-login) with a 423, and only lets read + recovery routes + read-only wp-cli through. This stops a second bad write while you diagnose. Clear it when done.
2. NEVER guess the culprit — read `rolepod_wp_recovery_status` + `rolepod_wp_recovery_list_changes` (or the wp-changes ledger) to find the exact file/plugin the last writes touched, then disable THAT.
3. NEVER run `rolepod_wp_maintenance_update(scope: core)` without a pre-made `backup_id` — a fresh backup does NOT capture core files, so a failed core update could not be rolled back. It refuses (MAINTENANCE_CORE_BACKUP_REQUIRED) without one.
4. If `rolepod_wp_maintenance_update` left the site behind the maintenance page, delete `ABSPATH/.maintenance` (the tool deactivates it in a `finally`, but a hard crash mid-update can strand it).
</EXTREMELY-IMPORTANT>

## When to use

- "The site is white-screening / 500 after I activated a plugin."
- "I edited functions.php and now it's a fatal error."
- "I need to update core/plugins but I'm scared it'll break prod."
- "I need to add rewrite rules to .htaccess safely."

## Boundary

Owns:

- `rolepod_wp_recovery_status` — guardian view: is the site fataling, what did it catch.
- `rolepod_wp_recovery_list_changes` — recent writes the guardian/ledger recorded (culprit hunt).
- `rolepod_wp_recovery_disable_file` / `rolepod_wp_recovery_disable_plugin` — neutralize the culprit.
- `rolepod_wp_recovery_restore_file` / `rolepod_wp_recovery_restore_snapshot` — put a known-good file/theme back.
- `rolepod_wp_recovery_safe_mode` — fail-closed write lock while you work.
- `rolepod_wp_maintenance_update` — backup → maintenance-mode → update → probe → auto-rollback (core/plugin/theme).
- `rolepod_wp_htaccess_edit` — sentinel-backed .htaccess replace with root + inner-permalink probe + auto-restore.

Does not own:

- The actual fix to the buggy code → `wp-edit-plugin` / `wp-content` once the site is reachable again.
- Full-site restore / migration → `wp-migrate` (`rolepod_wp_site_restore`).
- Deep diagnosis of WHY → `wp-diagnose`.

## Decision tree (live fatal)

1. `rolepod_wp_recovery_safe_mode(enabled: true)` — stop the bleeding.
2. `rolepod_wp_recovery_status` — confirm the fatal + what the guardian caught.
3. `rolepod_wp_recovery_list_changes` (or wp-changes ledger) — find the last writes.
4. Neutralize the culprit:
   - a plugin → `rolepod_wp_recovery_disable_plugin`.
   - a file (functions.php, an include) → `rolepod_wp_recovery_disable_file`, then `rolepod_wp_recovery_restore_file` from the pre-edit backup if one exists.
   - a theme → `rolepod_wp_recovery_restore_snapshot`.
5. Re-check `rolepod_wp_recovery_status` → site should be reachable.
6. `rolepod_wp_recovery_safe_mode(enabled: false)` — clear the lock.
7. Hand off the real fix to `wp-edit-plugin` / `wp-content`, then `wp-diagnose`.

## Safe maintenance (proactive)

- Update: `rolepod_wp_maintenance_update(scope: plugin|theme|core, slugs?, backup_id? [core], confirm_production?)`. It backs up, flips maintenance-mode (deactivating it in a `finally`), updates, health-probes, and — on red — pins core back / restores the backup and RE-PROBES before claiming `rolled_back:true`. A still-red site returns `rolled_back:false` + the `backup_id` for manual recovery. REST + companion + single-site only.
- .htaccess: `rolepod_wp_htaccess_edit(content, confirm_production?)`. Writes `.htaccess.bak` first, replaces `.htaccess`, then probes the site ROOT and one inner pretty-permalink (a lost RewriteRules block leaves `/` = 200 but inner pages = 404 — a false green). On failure it restores and re-probes; if a malformed `.htaccess` took Apache down so even the REST restore 500s, it says `rolled_back:false` and points you at `.htaccess.bak` to fix over SSH/filesystem.

## Hard stops

- `recovery_status` shows no companion / guardian → the guardian mu-plugin is not installed; recovery endpoints won't answer. Tell the user to install the rolepod-wp companion (which ships the guardian).
- Multisite → `rolepod_wp_maintenance_update` / `rolepod_wp_htaccess_edit` refuse (MULTISITE_UNSUPPORTED); recover by hand.
- Site still fatal after disabling the identified culprit → STOP, escalate to `wp-diagnose` + surface the guardian's recorded error verbatim; do not keep disabling plugins blindly.

## Next phase

- Site reachable → `wp-diagnose` to find the root cause, then the right edit skill to fix it properly.
- After a maintenance update → `wp-health-check` to confirm green.
