# Scaffold Manifest — {{type}}: {{slug}}

**target_id:** `{{target_id}}`
**siteurl:** {{siteurl}}
**run_at:** {{timestamp_utc}}
**type:** {{block | plugin | theme | pattern}}
**slug:** `{{slug}}`

## Files written ({{file_count}})

| # | Absolute path | Bytes | Backup |
|---|---|---|---|
| 1 | {{absolute_path_1}} | {{bytes_1}} | {{backup_path_1 | "(new)"}} |
| 2 | {{absolute_path_2}} | {{bytes_2}} | {{backup_path_2 | "(new)"}} |
| ... | | | |

## Files NOT written (would have overwritten)

{{
  if no skipped → "(none)"
  else → table of (path | reason | what to do)
}}

## Next concrete step

{{
  type=block → "Run `wp-edit-design` to drop `{{namespace}}/{{block_name}}` into a page layout."
  type=plugin → "Activate via `wp-content` (REST `POST /wp/v2/plugins` with `{slug:'<this-slug>', status:'active'}`). Then fill `{{plugin_slug}}/src/Endpoint/<your>.php` with the callback."
  type=theme → "Switch theme via wp-cli `theme activate {{slug}}` or REST `POST /wp/v2/themes`. Then `wp-health-check`."
  type=pattern → "Confirm the pattern appears at `/wp-json/wp/v2/block-patterns/patterns?slug={{slug}}`."
}}

## Rollback

If any of these files were unwanted:
- Use the backup path in column 4 to restore (if `(new)`, just delete the file).
- For directory-scale rollback: `rm -rf wp-content/plugins/{{slug}}` (plugin) or `wp-content/themes/{{slug}}` (theme).
