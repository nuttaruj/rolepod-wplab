# Gutenberg (block editor) — core blocks + popular library catalog

Reference for native-first Gutenberg page builds. **`core/html` block = last resort.**

## Detection

- Always available — Gutenberg is WP core since 5.0.
- Per-page signal: `post_content` contains `<!-- wp:<namespace>/<name> -->` HTML comments.
- Data shape: HTML with block delimiter comments. See `../builder-formats.md`.

## Iron rules

1. Native core block FIRST. `core/html` block = last resort.
2. Custom blocks (from third-party libraries) are second choice when core lacks the pattern.
3. After write, the block parser validates each delimiter — a malformed comment breaks all blocks below it. Use `rolepod_wp_post_get` to verify the round-trip parses.

## Block scope: core only vs popular library

This catalog focuses on **core blocks** (always available) + a short callout for popular block libraries (GenerateBlocks, Ultimate Blocks, Kadence Blocks). Project-specific custom blocks belong in `wp-scaffold`.

---

## Container blocks

### `core/group`

Generic wrapper. Supports background color, padding, max-width.

```html
<!-- wp:group {"className":"wnz-hero"} -->
<div class="wp-block-group wnz-hero">
  <!-- inner blocks -->
</div>
<!-- /wp:group -->
```

### `core/columns`

Multi-column row. Children are `core/column` blocks.

```html
<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column {"width":"33.33%"} -->
  <div class="wp-block-column" style="flex-basis:33.33%">...</div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

### `core/column`

Single column inside `core/columns`.

### `core/cover`

Group with a background image + overlay. Use for hero sections with bg image.

### `core/row` / `core/stack`

Flex containers (WP 6.0+).

---

## Block catalog

### `core/heading`

```html
<!-- wp:heading {"level":1,"className":"wnz-hero-h1"} -->
<h1 class="wnz-hero-h1">We build websites</h1>
<!-- /wp:heading -->
```

**Coverage:** 100% headlines.

### `core/paragraph`

```html
<!-- wp:paragraph -->
<p>Body copy.</p>
<!-- /wp:paragraph -->
```

### `core/list` + `core/list-item`

Ordered/unordered list.

### `core/button` (inside `core/buttons` parent)

```html
<!-- wp:buttons -->
<div class="wp-block-buttons">
  <!-- wp:button {"className":"wnz-btn"} -->
  <div class="wp-block-button wnz-btn"><a class="wp-block-button__link" href="...">Get started</a></div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

### `core/image`

### `core/gallery`

Static grid.

### `core/video`

### `core/audio`

### `core/file`

### `core/embed` + variants (`core/embed-youtube`, `core/embed-vimeo`, etc)

### `core/quote` + `core/pullquote`

### `core/preformatted` + `core/code` + `core/verse`

### `core/separator`

Horizontal rule.

### `core/spacer`

```html
<!-- wp:spacer {"height":"60px"} -->
<div style="height:60px" class="wp-block-spacer"></div>
<!-- /wp:spacer -->
```

### `core/details`

Native `<details>/<summary>` for FAQ. **Coverage P-003 FAQ.**

```html
<!-- wp:details -->
<details class="wp-block-details"><summary>Question</summary><p>Answer</p></details>
<!-- /wp:details -->
```

### `core/table`

### `core/navigation`

Site nav (FSE themes).

### `core/site-logo` / `core/site-title` / `core/site-tagline`

Theme-level globals.

### `core/post-*` family (query loop)

`core/query`, `core/post-template`, `core/post-title`, `core/post-content`, `core/post-date`, `core/post-author`, `core/post-featured-image`, `core/post-excerpt`. Use inside Query Loop for blog/archives.

### `core/latest-posts` / `core/latest-comments`

### `core/social-links`

### `core/search`

### `core/shortcode`

Drop a `[shortcode]` as a block.

### `core/html`

**LAST RESORT.** Raw HTML.

```html
<!-- wp:html -->
<div class="terminal">...</div>
<!-- /wp:html -->
```

Acceptable: terminal, marquee, scramble headline, custom SVG illustrations, embedded widgets from libraries the site doesn't have installed.

---

## Pattern recipes (Gutenberg core only)

### P-001 Hero

```html
<!-- wp:group {"className":"wnz-hero"} -->
<div class="wp-block-group wnz-hero">
  <!-- wp:heading {"level":1} --><h1>We build websites</h1><!-- /wp:heading -->
  <!-- wp:heading {"level":1,"className":"wnz-hero-h1-em"} --><h1 class="wnz-hero-h1-em">that work for business.</h1><!-- /wp:heading -->
  <!-- wp:paragraph --><p>Sub-paragraph.</p><!-- /wp:paragraph -->
  <!-- wp:buttons -->
  <div class="wp-block-buttons">
    <!-- wp:button --><div class="wp-block-button"><a class="wp-block-button__link" href="...">Primary</a></div><!-- /wp:button -->
    <!-- wp:button {"className":"is-style-outline"} --><div class="wp-block-button is-style-outline"><a class="wp-block-button__link" href="...">Ghost</a></div><!-- /wp:button -->
  </div>
  <!-- /wp:buttons -->
  <!-- (no native counter — use a popular library like ultimate-blocks/number-box OR write a custom block via wp-scaffold) -->
</div>
<!-- /wp:group -->
```

### P-002 Feature grid

```html
<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:image --> ... <!-- /wp:image -->
    <!-- wp:heading {"level":3} --><h3>Feature</h3><!-- /wp:heading -->
    <!-- wp:paragraph --><p>Description.</p><!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
  <!-- (repeat 2 more columns) -->
</div>
<!-- /wp:columns -->
```

For an icon-box-equivalent with SVG icons, core has no native widget — use a popular library OR a `core/html` block per card.

### P-003 FAQ

Use `core/details` per question. Native, semantic, no JS needed for collapse.

### P-004 Stat row

NO native counter block. Options:
1. Install Ultimate Blocks / Kadence Blocks (each has a counter block)
2. Write a custom block via `wp-scaffold` (proper way for client work)
3. `core/html` block per stat (last resort)

### P-005 Pricing

NO native pricing block. Options:
1. Install a block library (GenerateBlocks Pro has pricing layout)
2. Compose with `core/columns` + `core/heading` + `core/list` per tier
3. `core/html` per tier card

---

## Popular block libraries (when core lacks)

### Ultimate Blocks

Lightweight, free. Adds: counter, testimonial, tabs, accordion (alternative to `core/details`), table-of-contents, click-to-tweet.

### Kadence Blocks

Mid-weight, free + Pro tiers. Adds: row layout, icon list, info-box, advanced gallery, countdown, count-up, accordion.

### GenerateBlocks

Pure container + headline + button + image — minimal but pixel-perfect. Use with GeneratePress theme.

### Spectra (formerly Ultimate Addons for Gutenberg)

Comprehensive: counter, testimonial, pricing, team, blog post, table of contents, marketing button, multi-button group.

### Stackable

Headline, blockquote, container, posts, image-box, icon-box, feature, accordion, button.

---

## Common gotchas

- Block delimiter comments are sensitive — extra whitespace inside `<!-- wp:name {attrs} -->` can confuse the parser.
- `attrs` JSON inside the delimiter must be valid JSON.
- `core/buttons` is the WRAPPER; individual `core/button` blocks live inside. Don't nest button directly under group.
- FSE-only blocks (`core/template-part`, `core/post-author-biography`) only render inside FSE templates, not in regular post content.
- Reusable blocks (synced patterns) are stored as `wp_block` CPT entries — reference via `<!-- wp:block {"ref":42} /-->`.

---

## Helpers + tools

- `rolepod_wp_post_get(target_id, post_id)` — read block HTML from `post_content`
- `rolepod_wp_post_update(target_id, post_id, content)` — write block HTML
- For visual blocks tooling, build with `rolepod_wp_scaffold_block` to create custom blocks.
