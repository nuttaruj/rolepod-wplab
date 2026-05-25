---
name: wp-scaffold-theme
description: Bootstrap a minimum-viable WordPress block-theme skeleton (style.css + theme.json + functions.php + templates) on a connected target.
---

## When to use

- Starting a brand-new block-theme.
- A target WP install is connected.
- User can name the theme (slug + display name).

## When NOT to use

- Adding features to an existing theme. Use `rolepod_wp_file_write` for targeted edits.
- Customizing an existing block theme via theme.json — use `wp_file_write` on theme.json directly.

## Inputs

- `target_id`, `slug`, `name`, `description?`, `author?`.
- `allow_destructive: true` required (creates files on target).

## Outputs

- `theme_path`, `files_written[]`, `activate_command`.

## Process

1. Call `rolepod_wp_scaffold_theme` with constructed input.
2. Surface `activate_command` so user can switch themes.
3. Suggest follow-up: `/wp-health-check` to verify theme activates without errors.

## If the tool is unavailable

Same handling as other shipped skills.

## Examples

```
User: "/wp-scaffold-theme my-team-blog"
Lead → rolepod_wp_scaffold_theme { target_id, slug: "my-team-blog", name: "My Team Blog", allow_destructive: true }
       → 6 files under wp-content/themes/my-team-blog/
Lead reply: "Theme scaffolded. Activate: wp theme activate my-team-blog"
```
