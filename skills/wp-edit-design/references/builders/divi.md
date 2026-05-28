# Divi — module catalog + decision rules

Reference for native-first Divi page builds. **Raw HTML / Code module = last resort.**

## Detection

- Active theme `Divi` OR plugin `divi-builder/divi-builder.php`
- Per-page meta: `_et_pb_use_builder = 'on'`
- Data shape: shortcodes in `post_content` — `[et_pb_section][et_pb_row][et_pb_column][et_pb_<module>]...[/et_pb_*]`
- See `../builder-formats.md` for shortcode escaping rules.

## Iron rules

1. Native module FIRST. `[et_pb_code]` (Code Module) = last resort.
2. Divi shortcodes are NESTED — opening + closing tags must balance. Use `rolepod_wp_divi_read` to inspect before write.
3. **NEVER** raw-write JSON to a post_content field — Divi tracks the original shortcode form in `_et_pb_old_content` for the builder UI; bypassing it breaks the visual builder.

## Free vs Pro

Divi is paid (ElegantThemes subscription). All modules ship in base.

---

## Container primitives

### `et_pb_section`

Top-level container. Has fullwidth / specialty / regular variants.

### `et_pb_row`

1-6 column row inside a section.

### `et_pb_column`

Column inside a row. Width set via `type` attribute (`1_2`, `1_3`, `1_4`, `2_3`, `3_4`, etc).

```
[et_pb_section fb_built="1"]
  [et_pb_row column_structure="1_3,1_3,1_3"]
    [et_pb_column type="1_3"][/et_pb_column]
    [et_pb_column type="1_3"][/et_pb_column]
    [et_pb_column type="1_3"][/et_pb_column]
  [/et_pb_row]
[/et_pb_section]
```

---

## Module catalog

### `et_pb_text`

Rich text block. Handles headings + paragraphs + lists.

```
[et_pb_text]<h1>We build websites</h1>[/et_pb_text]
```

Coverage: 100% headings + paragraphs.

### `et_pb_button`

```
[et_pb_button button_text="Get started" button_url="https://..."][/et_pb_button]
```

### `et_pb_image`

### `et_pb_blurb`

Icon/image + title + description card. Equivalent of icon-box.

```
[et_pb_blurb title="Web Dev" image="https://..." use_icon="on" font_icon="%%18%%"]
Custom WordPress.
[/et_pb_blurb]
```

Coverage: 100% feature cards.

### `et_pb_number_counter`

Animated counter.

### `et_pb_circle_counter`

Radial percentage counter.

### `et_pb_bar_counters` / `et_pb_counter`

Progress bars.

### `et_pb_accordion` + `et_pb_accordion_item`

```
[et_pb_accordion]
  [et_pb_accordion_item title="Q1"]A1[/et_pb_accordion_item]
[/et_pb_accordion]
```

### `et_pb_tabs` + `et_pb_tab`

### `et_pb_pricing_tables` + `et_pb_pricing_table`

```
[et_pb_pricing_tables]
  [et_pb_pricing_table title="Pro" currency="$" sum="49"]Feature 1\nFeature 2[/et_pb_pricing_table]
[/et_pb_pricing_tables]
```

Coverage: 100% pricing rows. NO HTML widget fallback needed.

### `et_pb_testimonial`

### `et_pb_team_member`

### `et_pb_blog`

Posts loop.

### `et_pb_portfolio` / `et_pb_filterable_portfolio`

### `et_pb_gallery`

### `et_pb_image_carousel` / `et_pb_slider`

### `et_pb_video`

### `et_pb_menu`

### `et_pb_login`

### `et_pb_search`

### `et_pb_signup` (newsletter)

### `et_pb_contact_form` + `et_pb_contact_field`

### `et_pb_cta`

Single call-to-action box.

### `et_pb_divider`

### `et_pb_code`

**LAST RESORT.** Raw HTML/script/CSS.

```
[et_pb_code]<div class="terminal">...</div>[/et_pb_code]
```

Acceptable for: terminal blocks, marquees, custom embeds, third-party shortcodes.

---

## Pattern recipes (Divi)

### P-001 Hero

```
et_pb_section
└── et_pb_row (1_1)
    └── et_pb_column (type 4_4)
        ├── et_pb_text (h1 + sub paragraph)
        ├── et_pb_button × 2
        └── (nested row for stats)
            └── et_pb_row (1_4,1_4,1_4,1_4) → et_pb_number_counter × 4
```

### P-002 Feature grid

```
et_pb_row (1_3,1_3,1_3) → et_pb_blurb × 3 (one per column)
```

### P-003 FAQ

```
et_pb_accordion (with et_pb_accordion_item × N)
```

### P-005 Pricing

```
et_pb_pricing_tables (with et_pb_pricing_table × 3)
```

Divi WINS — pricing_tables is first-class. No HTML widget fallback needed.

---

## Common gotchas

- Shortcodes with attributes containing quotes must be escaped via `&#34;` (HTML entity) NOT backslash.
- Newlines inside an attribute value break the shortcode parser — strip them.
- Nested shortcodes use the same square-bracket syntax — order matters: opening of inner BEFORE closing of outer.
- The Visual Builder caches a hash of the shortcode tree (`_et_pb_old_content`) — after a programmatic write, call `update_post_meta($id, '_et_pb_old_content', $new)` too OR clear it via `delete_post_meta($id, '_et_pb_old_content')`.

---

## Helpers + tools

- `rolepod_wp_divi_read(target_id, page_id)` — parse shortcode tree
- `rolepod_wp_divi_write(target_id, page_id, content, backup: true)` — write with backup + clear builder cache
