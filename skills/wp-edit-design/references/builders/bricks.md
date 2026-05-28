# Bricks Builder — element catalog + decision rules

Reference for native-first Bricks page builds. **Raw HTML element = last resort.**

## Detection

- Active plugin: `bricks/bricks.php` or `bricks-builder/bricks-builder.php`
- Per-page meta: `_bricks_page_content_2` (JSON array of element objects)
- Data shape: flat array, each item is one element with `id`, `name`, `parent`, `children: []`, `settings: {}`
- See `../builder-formats.md` for the flat-array detail.

## Iron rules

1. Native element FIRST. HTML element (raw HTML wrapper) is a last resort.
2. Bricks elements are FLAT — each has a `parent` id string. Don't nest physically; nest via parent pointer.
3. After build run `rolepod_wp_bricks_read` to verify the round-trip JSON matches what you wrote.

## Free vs Pro

Bricks is a paid product but ALL widgets ship in the base license. No widget tier.

---

## Container primitives

### `container` / `section` / `block` / `div`

Same family; different defaults.

- `container` — outer-most wrapper, max-width applied by default
- `section` — full-width container
- `block` — generic flex/grid box
- `div` — minimal wrapper

```json
{
  "id": "abc123",
  "name": "container",
  "parent": "0",
  "children": ["def456","ghi789"],
  "settings": {
    "_columns": { "desktop": 3 },
    "_padding": { "top": "60", "right": "0", "bottom": "60", "left": "0" },
    "_cssClasses": "wnz-hero"
  }
}
```

---

## Element catalog

### `heading`

H1-H6 + custom HTML tag.

```json
{ "name": "heading", "settings": { "text": "We build websites", "tag": "h1", "_cssClasses": "wnz-hero-h1" } }
```

**Coverage:** 100% headlines.

### `text-basic`

Single-line text (no rich editor).

### `text`

Rich text body. Stores as raw HTML in `settings.text`.

```json
{ "name": "text", "settings": { "text": "<p>Body copy</p>" } }
```

**Coverage:** 100% paragraph blocks.

### `button`

```json
{ "name": "button", "settings": { "text": "Get started", "link": { "type": "external", "url": "..." }, "style": "primary" } }
```

**Coverage:** 100% buttons.

### `image`

Image with optional caption + link.

### `icon`

Single SVG icon. Built-in icon library (Themify, FontAwesome, IonIcons).

### `icon-box`

Icon + heading + text card.

### `counter`

Animated number + label + suffix.

### `accordion`

```json
{ "name": "accordion", "settings": { "accordion": [{"title":"Q1","content":"A1"}] } }
```

### `tabs` / `tabs-nested`

Horizontal/vertical tabs.

### `pricing-tables`

Single pricing tier card — chain multiple in a container row.

```json
{ "name": "pricing-tables", "settings": { "title": "Pro", "price": "49", "features": [...] } }
```

### `posts`

Loop of posts/CPT items.

### `team-members`

Team grid.

### `testimonials`

Testimonial slider.

### `image-gallery`

Static grid.

### `slider`

Image / video carousel.

### `video`

YouTube/Vimeo/self-hosted.

### `nav-menu`

Header menu — pull from WP nav menus.

### `logo`

Site logo.

### `breadcrumbs`

### `form`

Built-in form builder.

### `html`

**LAST RESORT.** Raw HTML.

```json
{ "name": "html", "settings": { "html": "<div class=\"terminal\">...</div>" } }
```

Acceptable for: terminal blocks, marquees, custom SVG illustrations, embeds Bricks doesn't natively support.

### `code`

Inline `<script>` / `<style>` block.

---

## Pattern recipes (Bricks)

### P-001 Hero

```
container (column layout, css "wnz-hero")
├── heading (tag h1)
├── heading (tag h1, with gradient class)
├── text (paragraph)
├── container (row, 2 children) → button × 2
└── container (4 columns) → counter × 4
```

### P-002 Feature grid (3 cards)

```
container (3 columns)
└── 3 × icon-box (icon + title + text)
```

### P-003 FAQ

```
container (1 col)
└── accordion (accordion array)
```

### P-005 Pricing

```
container (3 columns)
└── 3 × pricing-tables
```

Bricks WINS here — pricing-tables is a first-class element. No HTML widget fallback needed.

---

## Helpers + tools

- `rolepod_wp_bricks_read(target_id, page_id)` — read JSON tree
- `rolepod_wp_bricks_write(target_id, page_id, content, backup: true)` — write with backup
- No widget_schema introspection endpoint yet (Phase 7 candidate). Use this catalog as the reference.
