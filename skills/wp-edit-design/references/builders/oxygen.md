# Oxygen Builder — primitive catalog + decision rules

Reference for native-first Oxygen page builds. **Code Block = last resort.**

## Detection

- Active plugin: `oxygen/oxygen.php`
- Per-page signal: `ct_builder_shortcodes` meta exists OR `ct_builder_json` meta
- Data shape: flat array of element objects with parent references. See `../builder-formats.md`.

## Iron rules

1. Native Oxygen primitive FIRST. Code Block (raw HTML) = last resort.
2. Oxygen primitives are deliberately LOW-LEVEL — there's no "card widget"; you compose with `ct_div_block` + headings + paragraph + image. Treat each Oxygen page like a React component tree.
3. After write, run `rolepod_wp_oxygen_read` to verify the JSON round-trip.

## Free vs Pro

Oxygen is paid (Oxygen, Inc) but all primitives ship in base.

---

## Container primitives

### `ct_section`

Top-level full-width section.

### `ct_div_block`

Generic div (flex / grid / block).

### `ct_columns` + `ct_column`

Column row.

### `ct_inner_content`

Used inside template parts for content output.

---

## Element catalog

### `ct_headline`

Headline (h1-h6 + p + div).

### `ct_text_block`

Paragraph / rich text. Stores inline HTML.

### `ct_link_text`

Inline anchor text.

### `ct_link_button`

Button anchor.

### `ct_image`

### `ct_video`

### `ct_icon`

FontAwesome icon.

### `ct_shortcode`

Drop a WP shortcode.

### `ct_code_block`

**LAST RESORT.** Raw HTML/PHP/CSS/JS.

```json
{
  "name": "ct_code_block",
  "options": { "code-php": "...", "code-css": "...", "code-html": "<div class=\"terminal\">...</div>", "code-js": "..." }
}
```

Acceptable for: terminal, marquee, scramble headline, third-party embeds, custom PHP loops.

### `ct_form_*` (form builder primitives)

### `ct_modal`

### `ct_easy_posts`

Posts loop (Oxygen's query loop).

### `ct_pricing_box`

Pricing tier card.

### `ct_progress_bar`

### `ct_toggle`

Single accordion item.

### `ct_slider`

### `ct_search_form`

### `ct_breadcrumbs`

### `ct_woo_*`

WooCommerce hooks (product loop, cart, checkout).

---

## Pattern recipes (Oxygen)

### P-001 Hero

```
ct_section (css "wnz-hero")
├── ct_headline (h1)
├── ct_headline (h1 with gradient class)
├── ct_text_block (paragraph)
├── ct_link_button × 2
└── ct_div_block (4 columns flex)
    └── ct_div_block × 4 (each with a custom counter — Oxygen has NO native counter)
```

Oxygen lacks a counter primitive — use `ct_code_block` per stat (one per stat, not one for the row) OR install Hydrogen Pack / OxyExtras (third-party libraries that add Counter element).

### P-002 Feature grid

```
ct_section
└── ct_columns (3 columns)
    └── 3 × ct_div_block (each containing ct_icon + ct_headline + ct_text_block)
```

NO icon-box primitive — compose manually. Time-consuming but flexible.

### P-003 FAQ

```
ct_section
└── ct_div_block (column flex)
    └── N × ct_toggle (each = 1 Q+A)
```

### P-005 Pricing

```
ct_section
└── ct_columns (3 columns)
    └── 3 × ct_pricing_box (built-in primitive)
```

### P-008 Marquee / P-009 Terminal

`ct_code_block` is the only option. Acceptable.

---

## Common gotchas

- Oxygen primitives are FLAT but tracked by `id` + `parent` reference. Don't physically nest in JSON — list them flat and link via parent.
- Oxygen CSS classes are prefixed `oxy-` — your custom classes go in the `_cssClasses` option.
- The "Save" action in the builder regenerates `ct_builder_shortcodes` from the JSON tree — programmatic writes should update BOTH `ct_builder_json` and `ct_builder_shortcodes`.

---

## Helpers + tools

- `rolepod_wp_oxygen_read(target_id, page_id)` — read flat array
- `rolepod_wp_oxygen_write(target_id, page_id, content, backup: true)`

---

## Honest assessment

Oxygen's primitive-first philosophy means MORE recipe work for AI but MORE flexibility for the user later. For most mockup patterns, Bricks or Elementor produce a richer first-pass; Oxygen produces a leaner result that's easier to extend.

Recommend: use Oxygen for clients who explicitly want raw HTML/CSS control. For typical client work where the user wants visual editing, prefer Elementor or Bricks.
