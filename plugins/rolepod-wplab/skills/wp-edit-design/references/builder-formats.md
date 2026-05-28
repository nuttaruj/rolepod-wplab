# Page-builder data formats

How each adapter stores its layout, how to detect it, and the common write pitfalls.

## Elementor

**Storage:** `wp_postmeta` row, meta_key = `_elementor_data`, meta_value = JSON-encoded array of section objects.

**Detection:**
- Plugin file: `elementor/elementor.php` active.
- Per-page signal: `_elementor_edit_mode` meta exists.

**Shape (top → bottom):**
```json
[
  {
    "id": "abc12345",
    "elType": "section",
    "settings": { "structure": "30", ... },
    "elements": [
      { "id": "...", "elType": "column", "settings": { "_column_size": 100 }, "elements": [ ... widgets ... ] }
    ]
  }
]
```

**Pitfalls:**
- `elType` is lower-case in 3.x but the widget's `widgetType` is the snake_case name (e.g. `image-carousel`, not `ImageCarousel`).
- IDs are 8-char alphanumeric. Adapter regenerates them on write if absent.
- Custom fonts come from theme; missing fonts render as fallback silently.

## Divi

**Storage:** `wp_posts.post_content` itself — Divi stores its layout as shortcodes inside the same column as classic content.

**Detection:**
- Plugin file: `divi-builder/divi-builder.php` OR theme `Divi` active.
- Per-page signal: `_et_pb_use_builder` meta = `on`.

**Shape (top → bottom):**
```
[et_pb_section fb_built="1"]
  [et_pb_row]
    [et_pb_column type="4_4"]
      [et_pb_text]
        Lorem ipsum.
      [/et_pb_text]
    [/et_pb_column]
  [/et_pb_row]
[/et_pb_section]
```

**Pitfalls:**
- Shortcode escaping: nested `%22` instead of `"` inside attributes. Adapter handles encode/decode.
- Some Divi modules require companion shortcodes elsewhere on the page (e.g. blog post grid + filter pair).
- `fb_built="1"` is required for the visual builder to recognize the section as Divi-managed.

## Oxygen

**Storage:** `wp_postmeta` row, meta_key = `ct_builder_shortcodes` (JSON-encoded flat-array of element objects, parent linkage via `parent` id).

**Detection:**
- Plugin file: `oxygen/oxygen.php` active.
- Per-page signal: `ct_builder_shortcodes` meta exists.

**Shape (flat):**
```json
[
  { "id": 1, "name": "ct_section", "options": {...}, "parent": 0 },
  { "id": 2, "name": "ct_div_block", "options": {...}, "parent": 1 },
  { "id": 3, "name": "ct_text_block", "options": {...}, "parent": 2 }
]
```

**Pitfalls:**
- IDs are monotonic integers — never reuse on insert; adapter scans max + adds.
- Parent linkage is implicit; deleting a parent leaves orphans the visual editor cannot reach.
- Style settings live separately in `ct_user_css` (CSS string) — adapter does NOT touch CSS on layout writes.

## Bricks

**Storage:** `wp_postmeta` row, meta_key = `_bricks_page_content_2`, meta_value = JSON array of nested element objects (parent linkage via `children` array).

**Detection:**
- Theme `bricks` active (Bricks is a theme, not a plugin).
- Per-page signal: `_bricks_page_content_2` meta exists.

**Shape (nested):**
```json
[
  {
    "id": "abcde",
    "name": "section",
    "settings": {...},
    "children": [
      { "id": "fghij", "name": "container", "children": [
        { "id": "klmno", "name": "heading", "settings": {"text": "Hello"}, "children": [] }
      ] }
    ]
  }
]
```

**Pitfalls:**
- IDs are 5-char alphanumeric. Adapter regenerates on write if absent.
- Bricks supports template tags (e.g. `{post_title}`) — preserve them as literal strings.
- Some elements require `_meta` settings (e.g. heading `level`). Read the existing tree before adding new elements of the same type.

## theme.json (block themes)

**Storage:** file at `wp-content/themes/<theme>/theme.json`.

**Detection:** file exists + theme.json schema version key.

**Pitfalls:**
- WP merges user-set values (Site Editor global-styles) with file-set values. Editing the file alone may be overridden.
- After a theme.json change, `rest_request POST /wp/v2/global-styles/<id>/revisions` may be needed to bump the active revision; otherwise the editor caches stale.
- Bad JSON breaks the Site Editor on screen (white page in editor, frontend usually OK).

## Global styles (Site Editor)

**Storage:** a single post of type `wp_global_styles` per theme. REST: `/wp/v2/global-styles/<id>`.

**Detection:** always present in WP 5.9+ when a block theme is active.

**Write surface:** `rest_request POST /wp/v2/global-styles/<id>` with body `{ "styles": {...}, "settings": {...} }`. These shapes mirror theme.json.

**Pitfalls:**
- The `<id>` is theme-specific. Resolve via `/wp/v2/themes` then `/wp/v2/global-styles/themes/<stylesheet>`.
- Writes are atomic at the post level; partial updates merge by REST, so always read first if you need to keep unrelated styles.
