---
name: wp-scaffold-plugin
description: Bootstrap a new WordPress plugin skeleton with optional REST endpoint, admin page, Gutenberg block, or WP-CLI command on a connected target.
---

## When to use

- Starting a brand new WP plugin.
- A target WP install is connected.
- User can name the plugin (slug + display name).

## When NOT to use

- Adding features to an existing plugin. Use `rolepod_wp_file_write` or `/wp-scaffold-block` instead.
- Scaffolding a theme — use a theme generator (out of v0.1 scope; lands v0.2 as `/wp-scaffold-theme`).

## Inputs

- `target_id`.
- `slug` — folder/textdomain slug, lowercase-with-dashes (e.g. `my-team-tools`).
- `name` — human-readable plugin name (e.g. `My Team Tools`).
- `description?` — one-sentence plugin description.
- `author?` — author name + url.
- `features[]?` — any of: `rest_endpoint`, `admin_page`, `gutenberg_block`, `cli_command`.

## Outputs

- `run_id`, `plugin_path`, `files_written[]`, `activate_command`.

## Process

1. Call `rolepod_wp_scaffold_plugin` with constructed input.
2. Surface `activate_command` so user can run it via wp-cli (or wplab does it automatically when `allow_destructive=true`).
3. Suggest follow-up: `/wp-health-check` to verify activation succeeded.

## If the tool is unavailable

Same handling as other shipped skills.

## Examples

```
User: "/wp-scaffold-plugin my-team-tools with REST endpoint + admin page"
Lead → rolepod_wp_scaffold_plugin {
  target_id: "tgt_8585...",
  slug: "my-team-tools",
  name: "My Team Tools",
  features: ["rest_endpoint", "admin_page"]
}
Lead reply: "Created wp-content/plugins/my-team-tools/ (7 files)
              Activate: wp --path=... plugin activate my-team-tools
              REST endpoint stub: /wp-json/my-team-tools/v1/ping"
```
