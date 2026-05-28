---
verified_from: live runtime introspection
wordpress_version: 7.0
target: srv1475649.hstgr.cloud (demo)
audit_tool: WP_Block_Type_Registry::get_instance()->get_all_registered() + REST /wp/v2/block-types
verified_blocks: 105 registered (102 core + 3 plugin)
verified_at: 2026-05-28
---

# Gutenberg (block editor) — core blocks + popular library catalog

Reference for native-first Gutenberg page builds. **`core/html` block = last resort.**

Block names + parent / ancestor relationships below are pulled from `WP_Block_Type_Registry` on a live WP 7.0 demo target. WP 7.0 ships `core/accordion` + `core/math` + `core/breadcrumbs` + `core/terms-query` + `core/post-time-to-read` natively — older WP releases (6.x and below) may lack these. Re-introspect on the actual project target before depending on a recent block.

## Detection

- Always available — Gutenberg is WP core since 5.0.
- Per-page signal: `post_content` contains `<!-- wp:<namespace>/<name> -->` HTML comments.
- Data shape: HTML with block delimiter comments. See `../builder-formats.md`.

## Iron rules

1. Native core block FIRST. `core/html` block = last resort.
2. Custom blocks (from third-party libraries) are second choice when core lacks the pattern.
3. After write, the block parser validates each delimiter — a malformed comment breaks all blocks below it. Use `rolepod_wp_post_get` to verify the round-trip parses.

## Block scope: core only vs popular library

This catalog focuses on **core blocks** (always available in modern WP) + a short callout for popular block libraries. Project-specific custom blocks belong in `wp-scaffold`.

---

## Block catalog (verified live — WP 7.0)

### Design / container category

| Block | Parent | Notes |
|---|---|---|
| `core/group` | — | Generic wrapper. Bg color, padding, max-width. |
| `core/columns` | — | Multi-column row. Holds `core/column` children only. |
| `core/column` | `core/columns` | Single column. |
| `core/buttons` | — | Wrapper for `core/button` set. |
| `core/button` | `core/buttons` | Single button. Must live inside `core/buttons`. |
| `core/separator` | — | Horizontal rule. |
| `core/spacer` | — | Vertical gap. Customize height. |
| `core/more` | — | "Read more" cut for archives. |
| `core/nextpage` | `core/post-content` | Page break for multi-page posts. |
| `core/accordion` | — | **WP 7.0 native FAQ.** Children: `core/accordion-item`. |
| `core/accordion-item` | `core/accordion` | Wraps heading + panel. |
| `core/accordion-heading` | `core/accordion-item` | Toggle text. |
| `core/accordion-panel` | `core/accordion-item` | Hidden body. |
| `core/text-columns` | — | **DEPRECATED** — use `core/columns` instead. |
| `core/navigation-overlay-close` | — | Close button for nav overlay. |

### Text category

| Block | Parent | Notes |
|---|---|---|
| `core/paragraph` | — | Basic body copy. |
| `core/heading` | — | h1–h6 with `level` attr. |
| `core/list` | — | Ordered / unordered list. Holds `core/list-item`. |
| `core/list-item` | `core/list` | Single bullet. |
| `core/quote` | — | Standard `<blockquote>`. |
| `core/pullquote` | — | Larger quote with visual emphasis. |
| `core/code` | — | Inline code block. |
| `core/preformatted` | — | Whitespace-respecting text. |
| `core/verse` | — | Poetry / lyrics. |
| `core/table` | — | Rows × columns. |
| `core/details` | — | Native `<details>/<summary>` — collapse. Acceptable FAQ before WP 7.0's `core/accordion`. |
| `core/footnotes` | — | Auto-numbered footnotes added inline. |
| `core/math` | — | **WP 7.0** — LaTeX rendering. |
| `core/freeform` | — | Classic editor block (legacy bridge). |
| `core/missing` | — | Placeholder for blocks the site can't render. |

### Media category

| Block | Parent | Notes |
|---|---|---|
| `core/image` | — | Single image. |
| `core/gallery` | — | Static image grid. Holds `core/image` children. |
| `core/audio` | — | `<audio>` element. |
| `core/video` | — | `<video>` element. |
| `core/file` | — | Downloadable file link. |
| `core/cover` | — | Group with background image + overlay (hero block). |
| `core/media-text` | — | Side-by-side media + paragraph. |
| `core/icon` | — | **SVG icon block** — accepts an SVG payload. New in 7.x. |

### Widgets category

| Block | Parent | Notes |
|---|---|---|
| `core/shortcode` | — | Drop a `[shortcode]`. |
| `core/html` | — | **LAST RESORT.** Raw HTML. |
| `core/search` | — | Search form. |
| `core/social-links` | — | Wrapper for `core/social-link` children. |
| `core/social-link` | `core/social-links` | Single social icon. |
| `core/archives` | — | Date archive list. |
| `core/categories` | — | Term list. |
| `core/latest-posts` | — | Recent posts widget. |
| `core/latest-comments` | — | Recent comments widget. |
| `core/calendar` | — | Posts calendar. |
| `core/rss` | — | Feed reader widget. |
| `core/tag-cloud` | — | Sized term cloud. |
| `core/page-list` | — | Auto-rendered page list. Holds `core/page-list-item`. |
| `core/page-list-item` | `core/page-list` | One page entry. |
| `core/legacy-widget` | — | Bridges old widgets API. |
| `core/widget-group` | — | Wraps a set of widgets. |

### Embed category

| Block | Parent | Notes |
|---|---|---|
| `core/embed` | — | oEmbed wrapper (YouTube, Twitter, etc). |

### Theme (FSE) category

| Block | Parent | Ancestor | Notes |
|---|---|---|---|
| `core/site-logo` | — | — | Site logo image. |
| `core/site-title` | — | — | Site title text. |
| `core/site-tagline` | — | — | Tagline. |
| `core/navigation` | — | — | FSE nav menu. |
| `core/navigation-link` | `core/navigation` | — | Custom nav item. |
| `core/navigation-submenu` | `core/navigation` | — | Submenu. |
| `core/home-link` | `core/navigation` | — | Home link inside nav. |
| `core/template-part` | — | — | Header/footer/sidebar parts. |
| `core/loginout` | — | — | Login/logout links. |
| `core/avatar` | — | — | User avatar. |
| `core/breadcrumbs` | — | — | **WP 7.0** — native breadcrumb trail. |
| `core/pattern` | — | — | Pattern placeholder. |
| `core/post-title` | — | — | Post title inside Query Loop. |
| `core/post-content` | — | — | Post content inside Query Loop. |
| `core/post-date` | — | — | Post date. |
| `core/post-excerpt` | — | — | Post excerpt. |
| `core/post-featured-image` | — | — | Featured image. |
| `core/post-terms` | — | — | Categories/tags. |
| `core/post-time-to-read` | — | — | **WP 7.0** — reading time. |
| `core/post-navigation-link` | — | — | Prev/next post nav. |
| `core/post-author-name` | — | — | Author name. |
| `core/post-author-biography` | — | — | Author bio. |
| `core/post-author` | — | — | **DEPRECATED** — use `core/avatar` + `core/post-author-name` + `core/post-author-biography`. |
| `core/post-comments` | — | — | Legacy comments placeholder (no title — deprecated). |
| `core/post-comments-form` | — | — | Comment submission form. |
| `core/post-comments-count` | — | — | Comments count badge. |
| `core/post-comments-link` | — | — | Link to comments thread. |
| `core/read-more` | — | — | Read-more link. |
| `core/query` | — | — | Query Loop container. |
| `core/post-template` | — | `core/query` | Renders one post per loop iteration. |
| `core/query-pagination` | — | `core/query` | Pagination row. |
| `core/query-pagination-next` | `core/query-pagination` | — | Next page link. |
| `core/query-pagination-previous` | `core/query-pagination` | — | Previous page link. |
| `core/query-pagination-numbers` | `core/query-pagination` | — | Page-number row. |
| `core/query-no-results` | — | `core/query` | Fallback when zero posts. |
| `core/query-title` | — | — | Archive title. |
| `core/query-total` | — | `core/query` | **WP 7.0** — result count. |
| `core/terms-query` | — | — | **WP 7.0** — taxonomy term loop (parallel to Query Loop but for terms). |
| `core/term-template` | — | `core/terms-query` | One block per term. |
| `core/term-name` | — | — | Term display name. |
| `core/term-description` | — | — | Term description. |
| `core/term-count` | — | — | **WP 7.0** — term post count. |
| `core/comments` | — | — | Comments container. |
| `core/comment-template` | `core/comments` | — | One block per comment. |
| `core/comment-author-name` | — | `core/comment-template` | Comment author. |
| `core/comment-content` | — | `core/comment-template` | Comment body. |
| `core/comment-date` | — | `core/comment-template` | Comment timestamp. |
| `core/comment-edit-link` | — | `core/comment-template` | Edit link (logged-in only). |
| `core/comment-reply-link` | — | `core/comment-template` | Reply link. |
| `core/comments-pagination` | `core/comments` | — | Comment pagination. |
| `core/comments-pagination-next` | `core/comments-pagination` | — | Next page. |
| `core/comments-pagination-previous` | `core/comments-pagination` | — | Previous page. |
| `core/comments-pagination-numbers` | `core/comments-pagination` | — | Page numbers. |
| `core/comments-title` | — | `core/comments` | "N comments" title. |

### Reusable category

| Block | Parent | Notes |
|---|---|---|
| `core/block` | — | Reusable pattern reference. Render as `<!-- wp:block {"ref":42} /-->`. |

---

## Block markup recipes

### Group

```html
<!-- wp:group {"className":"wnz-hero"} -->
<div class="wp-block-group wnz-hero">
  <!-- inner blocks -->
</div>
<!-- /wp:group -->
```

### Columns + column

```html
<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column {"width":"33.33%"} -->
  <div class="wp-block-column" style="flex-basis:33.33%">...</div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->
```

### Heading

```html
<!-- wp:heading {"level":1,"className":"wnz-hero-h1"} -->
<h1 class="wnz-hero-h1">We build websites</h1>
<!-- /wp:heading -->
```

### Paragraph

```html
<!-- wp:paragraph -->
<p>Body copy.</p>
<!-- /wp:paragraph -->
```

### Buttons + button

```html
<!-- wp:buttons -->
<div class="wp-block-buttons">
  <!-- wp:button {"className":"wnz-btn"} -->
  <div class="wp-block-button wnz-btn">
    <a class="wp-block-button__link" href="...">Get started</a>
  </div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->
```

### Accordion (WP 7.0 native)

```html
<!-- wp:accordion -->
<div class="wp-block-accordion">
  <!-- wp:accordion-item -->
  <div class="wp-block-accordion-item">
    <!-- wp:accordion-heading -->
    <h3 class="wp-block-accordion-heading">Question?</h3>
    <!-- /wp:accordion-heading -->
    <!-- wp:accordion-panel -->
    <div class="wp-block-accordion-panel"><p>Answer.</p></div>
    <!-- /wp:accordion-panel -->
  </div>
  <!-- /wp:accordion-item -->
</div>
<!-- /wp:accordion -->
```

For WP 6.x compat: use `core/details` per Q+A instead.

### Cover (hero with bg image)

```html
<!-- wp:cover {"url":"https://example.com/hero.jpg","dimRatio":50} -->
<div class="wp-block-cover">
  <span class="wp-block-cover__background has-background-dim"></span>
  <img class="wp-block-cover__image-background" src="https://example.com/hero.jpg" />
  <div class="wp-block-cover__inner-container">
    <!-- inner blocks -->
  </div>
</div>
<!-- /wp:cover -->
```

### Spacer

```html
<!-- wp:spacer {"height":"60px"} -->
<div style="height:60px" class="wp-block-spacer"></div>
<!-- /wp:spacer -->
```

### Details (FAQ pre-7.0)

```html
<!-- wp:details -->
<details class="wp-block-details">
  <summary>Question</summary>
  <p>Answer</p>
</details>
<!-- /wp:details -->
```

### HTML (last resort)

```html
<!-- wp:html -->
<div class="terminal">...</div>
<!-- /wp:html -->
```

Acceptable for: terminal, marquee, scramble headline, custom SVG (when `core/icon` doesn't fit), embedded widgets from libraries the site doesn't have installed.

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
  <!-- (no native counter — see P-004 options) -->
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

For icon-box equivalent with SVG icons, use `core/icon` (WP 7.x) per card OR `core/html` if SVG inline.

### P-003 FAQ

- **WP 7.0+:** `core/accordion` → `core/accordion-item` per Q (heading + panel).
- **WP 6.x:** `core/details` per Q. Native, semantic, no JS needed for collapse.

### P-004 Stat row

NO native counter block. Options:
1. Install Ultimate Blocks / Kadence Blocks (each has a counter block).
2. Write a custom block via `wp-scaffold` (proper way for client work).
3. `core/html` block per stat (last resort).

### P-005 Pricing

NO native pricing block. Options:
1. Install a block library (GenerateBlocks Pro has pricing layout).
2. Compose with `core/columns` + `core/heading` + `core/list` per tier.
3. `core/html` per tier card.

### P-011 Header / P-012 Footer

Use FSE template parts: `core/template-part` referencing `header` / `footer` slugs. Inside, compose with `core/site-title`, `core/navigation`, `core/social-links`.

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

### Third-party blocks verified on demo target

| Block | Use |
|---|---|
| `contact-form-7/contact-form-selector` | Embed CF7 form by ID. |
| `yoast/faq-block` | Yoast FAQ with structured-data schema. Replaces manual JSON-LD. |
| `yoast/how-to-block` | How-to guide with Schema.org markup. One per post. |
| `yoast-seo/breadcrumbs` | Yoast breadcrumbs (template or content). Pair with `core/breadcrumbs` if both Yoast + WP 7.0 — pick one. |

---

## Common gotchas

- Block delimiter comments are sensitive — extra whitespace inside `<!-- wp:name {attrs} -->` can confuse the parser.
- `attrs` JSON inside the delimiter must be valid JSON.
- `core/buttons` is the WRAPPER; individual `core/button` blocks live inside. Don't nest button directly under group.
- `core/accordion-item` MUST contain both `core/accordion-heading` AND `core/accordion-panel` — missing either silently renders empty.
- `core/list-item` only works inside `core/list` — placing it elsewhere drops to a `core/missing` block.
- FSE-only blocks (`core/template-part`, `core/post-author-biography`) only render inside FSE templates, not in regular post content.
- Reusable blocks (synced patterns) are stored as `wp_block` CPT entries — reference via `<!-- wp:block {"ref":42} /-->`.
- Query Loop ancestor blocks (`core/post-*`) silently render nothing outside a `core/query` ancestor.
- `core/post-author` is deprecated — emit deprecation warning at editor load. Use the trio `core/avatar` + `core/post-author-name` + `core/post-author-biography`.
- `core/text-columns` is deprecated since WP 5.x — use `core/columns`.

---

## Helpers + tools

- `rolepod_wp_post_get(target_id, post_id)` — read block HTML from `post_content`
- `rolepod_wp_post_update(target_id, post_id, content)` — write block HTML
- `rolepod_wp_scaffold_block` — generate a custom block for project-specific patterns (counter, pricing, etc).

---

## Quick reference card

| Pattern in mockup | Use this block | Don't use |
|---|---|---|
| Headline / page title | `core/heading` | `core/html` |
| Paragraph / body copy | `core/paragraph` | `core/html` |
| Single CTA | `core/buttons` + `core/button` | `core/html` |
| FAQ (WP 7.0+) | `core/accordion` + items | `core/html` |
| FAQ (WP 6.x) | `core/details` per Q | `core/html` |
| Hero with bg image | `core/cover` | `core/group` + raw `<img>` |
| Hero plain | `core/group` + heading + paragraph + buttons | one big `core/html` |
| 3-column feature grid | `core/columns` (3) + per-column heading + paragraph | `core/html` |
| Image gallery | `core/gallery` | `core/html` |
| Image | `core/image` | `core/html` |
| SVG icon | `core/icon` (WP 7.x) | `core/html` |
| Visual separator | `core/separator` | `core/html` |
| Vertical gap | `core/spacer` | `core/html` |
| Math notation | `core/math` (WP 7.0) | `core/html` with KaTeX |
| Breadcrumb trail | `core/breadcrumbs` (WP 7.0) or `yoast-seo/breadcrumbs` | `core/html` |
| Social icons row | `core/social-links` | `core/html` |
| Pricing card | block library (Spectra/Kadence) or `wp-scaffold` custom block | `core/html` |
| Counter / stat | block library (Ultimate Blocks / Kadence) or `wp-scaffold` | `core/html` |
| Terminal / marquee / scramble | `core/html` (acceptable) | — |
| Blog feed | `core/query` + `core/post-template` + post-* blocks | `core/latest-posts` (less control) |
| Site header (FSE) | `core/template-part` (header slug) | inline `core/group` |
| CF7 form | `contact-form-7/contact-form-selector` | `core/shortcode` (works but less editor-friendly) |
