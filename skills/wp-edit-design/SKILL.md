---
name: wp-edit-design
description: Read or modify visual layouts on a connected target — Elementor, Divi, Oxygen, Bricks widget trees + theme.json + global-styles. Phase = Build.
when_to_use: user wants to design / change a page visually, edit a builder layout, set theme colors/typography, modify block-theme global styles, OR mentions any of "elementor / divi / oxygen / bricks / theme.json"
tier: 1
phase: build
---

# WP Edit Design

Visual / layout writes. Auto-detects the active page builder, backs up before overwrite, and writes the builder-native data shape. Also covers block-theme `theme.json` + Site Editor global-styles.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER overwrite a builder's widget tree without `backup: true` — every adapter writes a `<key>_wplab_backup` meta side-row before replacing; restore-from-backup is the only safety net for tree-shape mistakes.
2. NEVER hand-write Divi shortcodes / Oxygen JSON / Bricks JSON / Elementor `_elementor_data` without first reading the existing structure via `*_read` — every builder has version-specific shape quirks (Elementor `widgetType` capitalization, Divi `et_pb_*` opening tags, Oxygen flat-array container refs).
3. ALWAYS run `wp-health-check` on the target after a global-styles or theme.json write — bad JSON in those surfaces breaks the Site Editor irrecoverably on screen but the REST returns 200, so the failure mode is invisible until reload.
</EXTREMELY-IMPORTANT>

## When to use

- "Design a landing page in Elementor"
- "Change the Divi hero section"
- "Update Oxygen breakpoints"
- "Modify Bricks widget order"
- "Set theme.json palette to ..."
- "Edit global styles"

Skip when:
- The content is core (paragraphs/headings in classic or Gutenberg) → `wp-content`.
- The plugin's own settings (Yoast post meta, ACF fields) → `wp-edit-plugin`.
- Creating a new block/theme from scratch → `wp-scaffold`.

## Boundary

Owns:
- `rolepod_wp_elementor_{read,write}` — `_elementor_data` widget tree.
- `rolepod_wp_divi_{read,write}` — `et_pb_*` shortcode tree in post_content.
- `rolepod_wp_oxygen_{read,write}` — Oxygen JSON in `ct_builder_*` post meta.
- `rolepod_wp_bricks_{read,write}` — Bricks JSON in `_bricks_page_content_2` meta.
- `theme.json` writes via `file_write` to the active theme.
- Global styles via `rest_request POST /wp/v2/global-styles/<id>`.

Does not own:
- Plugin settings (Yoast / RankMath / WPML / WooCommerce / ACF / Forms) → `wp-edit-plugin`.
- Block-pattern registration in PHP → `wp-scaffold`.
- New theme bootstrap → `wp-scaffold`.

Return / hand off:
- The builder is not active → tell user to install + activate, OR work in core Gutenberg (`wp-content`).
- The change affects SEO meta → after design write, hand off to `wp-edit-plugin` for Yoast/RankMath.

## Inputs to gather

- target_id.
- For builder edits: `page_id` (post/page ID) + the builder name (or `auto-detect`).
- For theme.json: theme slug (active theme by default) + JSON patch.
- For global-styles: the global-styles post ID (one per theme).

## Workflow

### 1. Detect the active builder

If the user named one ("edit in Elementor"), use it. Else call each `*_read` with `page_id`; first one that returns `detected: true` is the active builder for that page. See `references/builder-formats.md` for the per-builder detection signal.

### 2. Read the current tree

Always read before write. The structures are non-obvious — see `references/builder-formats.md` for each shape.

### 3. Plan the diff

Describe the change to the user in plain text BEFORE writing the new tree: "I will add a 3-column section with widgets X, Y, Z between the current hero and the testimonial block." If the user has not approved, do not write.

### 4. Write with backup

All adapter `*_write` calls accept `backup: true` (default true on this skill). The adapter writes `<key>_wplab_backup` containing the prior tree. Surface the backup key so the user can rollback manually.

### 5. Verify

Call `wp-health-check`. If the change touched theme.json or global-styles → also `rest_request GET /wp/v2/global-styles/<id>` to confirm the new value is loadable.

## If a matching Rolepod agent is available

- `rolepod:ui-ux-designer` for layout decisions + accessibility checks.
- `rolepod:frontend-developer` for component-level JS/CSS.

## If no matching agent is available

1. Detect builder.
2. Read current tree.
3. Describe diff to user, wait for OK.
4. Write with backup.
5. Health-check.

## Output

No durable artifact per call. The adapter's backup meta is the rollback artifact, named `<original_key>_wplab_backup` and held in `wp_postmeta`.

## Examples

Read when constructing a widget tree non-trivially or when the diff is multi-section:
- `examples/design-examples.md` — good vs bad Elementor section edit; good vs bad theme.json palette change.

## References

Load before the FIRST write for any given builder on a target:
- `references/builder-formats.md` — per-builder data shape, detection signal, common pitfalls (Elementor widget vs section vs column, Divi shortcode escaping, Oxygen flat-array refs, Bricks element nesting).

## Hard stops

- `*_write` returns `BUILDER_NOT_ACTIVE` → STOP, tell user to activate the plugin or pick a different builder.
- `*_write` returns `BACKUP_FAILED` → STOP, do NOT retry without backup; the postmeta write failed and writing forward could lose the live tree.
- Theme.json JSON parse fails server-side → STOP, surface the line/column from `json_last_error`; ask user to confirm the patch.

## Full Rolepod enhancement

Full Rolepod adds visual-diff confirmation via the `rolepod-uiproof` sibling (snapshot before + after, surface side-by-side). Standalone, the user reviews live.

## Next phase

- Verify reachable → `wp-health-check`.
- If SEO meta needs updating for the new page → `wp-edit-plugin`.
- If iterating the layout → loop back to `wp-edit-design`.
