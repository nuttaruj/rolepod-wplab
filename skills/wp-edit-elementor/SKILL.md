---
name: wp-edit-elementor
description: Read or modify Elementor page widget trees on a connected WP target via the Elementor adapter.
---

## When to use

- User wants to inspect or modify an Elementor page structure programmatically (audit widgets, bulk-update settings, migrate between page builders).
- Target has Elementor active.

## When NOT to use

- Page builder is not Elementor. Use Bricks adapter (`/wp-bricks-read`) or fall back to manual edit.
- Manual editing in the Elementor admin is faster for one-off design changes.

## Inputs

- `target_id`, `page_id`.
- For reads: `rolepod_wp_elementor_read { target_id, page_id }`.
- For writes: `rolepod_wp_elementor_write { target_id, post_id, widget_tree, allow_destructive: true, confirm? }`.

## Outputs

- Read: `pages[] | page` (widget_tree array of nested elements).
- Write: `bytes_written`, `backup_path` (pre-write backup of `_elementor_data` meta).

## Process

1. Detect Elementor active on target (adapter handshake — `detected` field).
2. For writes: production guard fires unless `confirm: true`.
3. Call adapter tool.
4. Surface diff summary or read content.

## If the tool is unavailable

Either: Elementor not active on this target, OR write op needs companion v0.2 fs-write endpoint and companion not installed. Doctor will distinguish.

## Examples

```
User: "list Elementor pages on staging.client.com"
Lead → rolepod_wp_elementor_read { target_id: tgt_staging }
       → pages: [{ id: 7, title: "Home" }, ...]
```
