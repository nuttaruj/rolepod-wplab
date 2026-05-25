---
name: wp-scaffold-block
description: Generate a Gutenberg block (PHP register + JS + CSS + block.json) into an existing WordPress plugin or theme on a connected target.
---

## When to use

- User asks to create a new Gutenberg block.
- A target WordPress install is connected.
- A destination plugin slug or theme slug is identified.

## When NOT to use

- Editing an existing block. Use `rolepod_wp_file_write` directly with the specific file.
- Creating a non-Gutenberg widget. Use `wp_scaffold_plugin` with `features: ['admin_page']` instead.
- The destination plugin/theme doesn't exist yet. First run `/wp-scaffold-plugin` then come back.

## Inputs

- `target_id` — connected WP target.
- `destination` — `{ plugin_slug: string }` or `{ theme_slug: string }`.
- `block.slug` — namespaced, e.g. `my-team/testimonial`.
- `block.title`, `block.description?`, `block.category?`, `block.icon?`.
- `block.attributes?` — schema for block attributes.
- `block.supports?` — Gutenberg `supports` object.
- `render_strategy` — `dynamic` (PHP render callback) or `static` (save() output).
- `scaffold_test?` — if true, also generate a Playwright Test scaffold for rolepod-uiproof to run.

## Outputs

- `run_id`, `files_written[]`, `files_modified[]`, `test_file?`, `next_steps[]`.

## Process

1. Confirm the destination plugin/theme exists on the target — call `rolepod_wp_cli_run { args: ['plugin', 'is-installed', '<slug>'] }` if plugin_slug given.
2. Construct `rolepod_wp_scaffold_block` input from user intent (composite tool — lands v0.1+).
3. Call the tool.
4. Surface `next_steps[]` to the user — usually one of: activate parent plugin, rebuild block.json, run `wp cache flush`.

## If the tool is unavailable

The rolepod-wplab MCP server is not registered or is not responding. Run `rolepod-wplab doctor`.

Do NOT attempt to hand-write block files via raw `rolepod_wp_file_write` — the composite handles asset registration, dependency tracking, and test scaffolding consistently.

## Examples

```
User: "/wp-scaffold-block testimonial card into my-team plugin, dynamic render"
Lead → rolepod_wp_scaffold_block {
  target_id: "tgt_8585...",
  destination: { plugin_slug: "my-team" },
  block: { slug: "my-team/testimonial-card", title: "Testimonial Card", category: "design" },
  render_strategy: "dynamic"
}
Lead reply: "Generated 4 files under wp-content/plugins/my-team/blocks/testimonial-card/
              Next steps:
                1. cd wp-content/plugins/my-team && npm run build
                2. wp cache flush
                3. Refresh editor — block appears in 'Design' category"
```
