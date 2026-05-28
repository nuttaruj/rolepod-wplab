# Elementor — widget catalog + decision rules

Reference for native-first Elementor page builds. **HTML widget = last resort.**

## Detection

- Active plugin: `elementor/elementor.php`
- Per-page meta: `_elementor_edit_mode = 'builder'`
- Data shape: `_elementor_data` (JSON of section tree). See `../builder-formats.md`.

## Iron rules

1. **Always check this catalog FIRST.** Pick a native widget when one covers ≥70% of the visual pattern. Add a `_css_classes` class + custom CSS in the theme for the remaining 30%.
2. **HTML widget is allowed only when** a pattern has no native equivalent (terminal, marquee, scramble headline, custom SVG illustration).
3. **One HTML widget per CARD, not per SECTION.** A 6-card grid should still use 6 column-wrapped widgets (HTML or icon-box), NOT one giant HTML block.
4. **After build run `rolepod_wp_elementor_validate_data`** — catches setting shape errors against the live schema.
5. **Run `rolepod_wp_elementor_html_audit`** — if HTML widget count > 30% of widget total, refactor before commit.

## Free vs Pro

- This catalog targets **Elementor Free 4.x** (4.1+).
- Pro-only widgets are flagged `(Pro)`. Plan around free unless the target has Pro installed (check via `wp plugin list`).
- Some controls behave differently across 4.x minor versions — confirm via `rolepod_wp_elementor_widget_schema` before committing JSON.

---

## Section / Column primitives

### `section`

Top-level container. Holds columns + inner sections. Owns the visual box (background, padding, max-width).

```json
{
  "elType": "section",
  "settings": {
    "structure": "10|20|30|40|50|60|33|14|26|...",
    "content_width": { "unit": "px", "size": 1200 },
    "stretch_section": "section-stretched",
    "gap": "no|narrow|extended|wide",
    "padding": { "unit": "px", "top": "0", "right": "0", "bottom": "0", "left": "0", "isLinked": true },
    "_css_classes": "wnz-hero"
  },
  "elements": [/* column children */]
}
```

**`structure` code reference:**

| Code | Columns | Notes |
|---|---|---|
| `10` | 1 (100%) | Full width |
| `20` | 2 (50/50) | Equal split |
| `30` | 3 (33/33/33) | Equal split |
| `40` | 4 (25%) | Equal split |
| `50` | 5 | |
| `60` | 6 | |
| `33` | 2 (33/66) | Asymmetric |
| `66` | 2 (66/33) | Asymmetric |
| `14` | 4 with first wide | |
| `25` | 2 (25/75) | |
| `27` | 2 (75/25) | |

`stretch_section: 'section-stretched'` makes the section break out of `.entry-content` constraint — needed for full-bleed backgrounds.

**Inner section:** same shape, set `isInner: true`. Use inside a column to nest a sub-grid (e.g., 4-column stat row inside a 1-column hero).

### `column`

Lives inside a section. Holds widgets.

```json
{
  "elType": "column",
  "settings": {
    "_column_size": 33,
    "_inline_size": null,
    "padding": { ... }
  },
  "elements": [/* widget children */]
}
```

`_column_size` must add up to 100 across sibling columns (e.g., 4 columns × 25). For asymmetric structures, follow the structure code: `33` → first col 33, second col 67.

---

## Widget catalog

### `heading`

H1-H6. Pure text. Use for every titled block.

```json
{
  "widgetType": "heading",
  "settings": {
    "title": "We build websites",
    "header_size": "h1|h2|h3|h4|h5|h6|div",
    "size": "small|medium|large|xl|xxl",
    "align": "left|center|right",
    "_css_classes": "wnz-hero-title"
  }
}
```

**Coverage:** 100% of headlines. **Quirks:** the `title` is plain text — for inline `<em>` mixed-style you need two stacked Heading widgets OR a `text-editor` widget.

### `text-editor`

Rich content (paragraphs, lists, inline tags). Stores `editor` as raw HTML.

```json
{
  "widgetType": "text-editor",
  "settings": {
    "editor": "<p>Body copy with <em>inline</em> and <strong>marks</strong>.</p>",
    "drop_cap": "",
    "_css_classes": "wnz-sub"
  }
}
```

**Coverage:** 100% of body copy. **Quirks:** WP `wp_kses_post` sanitizer runs on save — strips any tag/attr not on the post-content allowlist.

### `button`

CTA. Single button. Pair two for primary + ghost.

```json
{
  "widgetType": "button",
  "settings": {
    "text": "Get started",
    "link": { "url": "https://example.com", "is_external": "", "nofollow": "" },
    "size": "xs|sm|md|lg|xl",
    "align": "left|center|right|justify",
    "button_type": "default|info|success|warning|danger",
    "icon": { "value": "fas fa-arrow-right", "library": "fa-solid" },
    "icon_align": "left|right",
    "_css_classes": "wnz-btn wnz-btn-ghost"
  }
}
```

**Coverage:** 100% of buttons. For mockup-specific look, add `_css_classes` + theme CSS targeting `.wnz-btn .elementor-button`.

### `image`

Static image. Use for logos, hero photos, decorative shots.

```json
{
  "widgetType": "image",
  "settings": {
    "image": { "id": 123, "url": "https://example.com/hero.jpg" },
    "image_size": "thumbnail|medium|large|full",
    "align": "left|center|right",
    "link_to": "none|file|custom",
    "caption_source": "none|attachment|custom"
  }
}
```

**Coverage:** 100% of image embeds.

### `icon`

Single icon. Use for inline decorative icons.

```json
{
  "widgetType": "icon",
  "settings": {
    "selected_icon": { "value": "fas fa-star", "library": "fa-solid" },
    "view": "default|stacked|framed",
    "shape": "circle|square"
  }
}
```

### `icon-box`

Icon + title + description card. Use for feature grids, service cards, process steps.

```json
{
  "widgetType": "icon-box",
  "settings": {
    "selected_icon": { "value": "fas fa-code", "library": "fa-solid" },
    "title_text": "Web Development",
    "description_text": "Custom WordPress builds.",
    "view": "default|stacked|framed",
    "position": "top|left|right",
    "title_size": "h1|h2|h3|h4|h5|h6",
    "link": { "url": "" },
    "_css_classes": "wnz-card"
  }
}
```

**Coverage:** 80% of feature cards. **Quirks:** `selected_icon` accepts only Font Awesome (free + brands). Custom SVG illustrations require HTML widget fallback. For multi-line feature lists below the description, use Icon Box + a separate Text Editor widget OR HTML widget per card.

### `image-box`

Image + title + description (image instead of icon). Card variant.

### `counter`

Animated number stat.

```json
{
  "widgetType": "counter",
  "settings": {
    "starting_number": 0,
    "ending_number": 120,
    "prefix": "",
    "suffix": "+",
    "title": "Projects shipped",
    "duration": 1400,
    "num_decimals": 0,
    "thousand_separator": "yes",
    "thousand_separator_char": ","
  }
}
```

**Coverage:** 100% of stat counters. **Quirks:** `num_decimals` up to 3. Animation triggers on scroll-into-view (IntersectionObserver under the hood); full-page screenshots may show 0 because stitching doesn't fire IO.

### `progress`

Linear progress bar with label.

### `accordion`

FAQ / collapsible list.

```json
{
  "widgetType": "accordion",
  "settings": {
    "tabs": [
      { "_id": "abc12345", "tab_title": "Question 1?", "tab_content": "Answer 1." },
      { "_id": "def67890", "tab_title": "Question 2?", "tab_content": "Answer 2." }
    ],
    "title_html_tag": "div|h2|h3|h4|h5|h6",
    "icon": "fa fa-plus",
    "icon_active": "fa fa-minus",
    "icon_align": "left|right",
    "selected_icon": { "value": "fas fa-plus", "library": "fa-solid" },
    "selected_active_icon": { "value": "fas fa-minus", "library": "fa-solid" }
  }
}
```

**Coverage:** 100% of FAQ blocks. **Quirks:**

- **Legacy `icon` field is a STRING** (`"fa fa-plus"`), NOT an array. Passing `{value, library}` to `icon` renders `<i class="... Array">` — silent bug. Pass BOTH `icon` (string) AND `selected_icon` (array) for cross-version safety. Caught by `rolepod_wp_elementor_validate_data`.
- Rendered `.elementor-tab-content` doesn't get `display:none` by default — add CSS reset in theme.

### `toggle`

Like accordion but only one item open at a time.

### `tabs`

Horizontal/vertical tabs.

```json
{
  "widgetType": "tabs",
  "settings": {
    "tabs": [
      { "_id": "...", "tab_title": "Tab 1", "tab_content": "..." }
    ]
  }
}
```

### `testimonial`

Single testimonial: image + name + role + quote.

### `testimonial-carousel` (Pro)

Slider of testimonials.

### `image-carousel`

Image slider.

```json
{
  "widgetType": "image-carousel",
  "settings": {
    "carousel": [
      { "id": 1, "url": "..." }
    ],
    "slides_to_show": "3",
    "slides_to_scroll": "1",
    "autoplay": "yes"
  }
}
```

### `image-gallery`

Static grid of images.

### `video`

Embeds YouTube/Vimeo/self-hosted.

### `divider`

Visual separator line.

### `spacer`

Empty vertical gap.

```json
{
  "widgetType": "spacer",
  "settings": { "space": { "unit": "px", "size": 60 } }
}
```

### `social-icons`

Row of social media icons.

### `nav-menu` (Pro)

Header nav menu.

### `posts` (Pro)

Loop of posts from a query.

### `portfolio` (Pro)

Filterable portfolio grid.

### `price-table` (Pro)

Pricing card. **Free workaround:** Icon Box + HTML widget for feature list + Button.

### `price-list` (Pro)

Restaurant-style price list.

### `countdown` (Pro)

Live countdown.

### `form` (Pro)

Form builder. **Free workaround:** Contact Form 7 + the `[contact-form-7 id=...]` shortcode dropped into a Text Editor widget.

### `flip-box` (Pro)

Two-sided card with hover flip.

### `call-to-action` (Pro)

CTA composite.

### `media-carousel` (Pro)

### `share-buttons` (Pro)

### `html`

**LAST RESORT.** Raw HTML. Use only when no native widget covers the visual.

```json
{
  "widgetType": "html",
  "settings": {
    "html": "<div class=\"terminal\">...</div>"
  }
}
```

**Acceptable use:**

- Terminal block with typer animation (data-typer JSON attribute)
- Marquee strip (no native marquee in free)
- Scramble headline (needs scramble script binding)
- Custom SVG illustrations beyond Font Awesome
- Pricing tier card body (free has no Price Table)
- Mockup-specific compound layouts that would require 10+ native widgets

**NOT acceptable use:**

- Plain headings → use `heading`
- Paragraphs → use `text-editor`
- Buttons → use `button`
- Counter stats → use `counter`
- FAQ → use `accordion`
- Feature cards with icon + title + desc → use `icon-box`
- Whole hero/services/process/portfolio/pricing section in one widget → BREAK INTO PIECES

### `shortcode`

Drops in a WP shortcode. Use for CF7, Yoast widgets, custom plugin shortcodes.

```json
{
  "widgetType": "shortcode",
  "settings": { "shortcode": "[contact-form-7 id='42']" }
}
```

---

## Common gotchas + workarounds (drawn from the WalnutZtudio build)

### Section `_css_classes` doesn't render on the `<section>` tag

**Symptom:** Set `_css_classes: 'wnz-hero'` on a section's settings, the class never appears on the rendered `<section>` tag. Widget-level `_css_classes` works fine.

**Root cause:** Elementor 4.x fires `elementor/frontend/before_render` only for widgets, not sections. The legacy `elementor/element/before_render` only fires in editor / control-panel context.

**Fix:** Shipped in rolepod-wp v2.12.1's `ElementorCompat` class. Uses `elementor/frontend/the_content` filter to post-process the rendered HTML and inject the classes. Works automatically when companion is active.

### Counter widget shows 0 in screenshots

**Symptom:** `rolepod-uiproof` full-page screenshot shows counter at `0` instead of the target value.

**Root cause:** Counter widget animates on scroll-into-view via IntersectionObserver. Full-page screenshot rendering stitches multiple viewports — IO doesn't fire across stitches.

**Fix:** Real user sees correct animation on scroll. For screenshots, add a wait step that scrolls to each counter section + waits 1500ms before capture.

### Accordion `icon` setting silently renders "Array"

**Symptom:** `<i class="elementor-accordion-icon-closed Array"></i>` — empty icon space.

**Root cause:** Legacy `icon` control expects a string class (e.g., `"fa fa-plus"`). Passing the new `{value, library}` array shape (used by the modern `selected_icon` field) is silently stringified to `"Array"`.

**Fix:** Pass BOTH `icon` (string) AND `selected_icon` (array). The validator (`rolepod_wp_elementor_validate_data`) catches this before commit.

### Native widget DOM nesting requires CSS scope

**Symptom:** Custom CSS keyed to `.wnz-headline` doesn't style the heading text.

**Root cause:** Elementor wraps the actual `<h1>` in `.elementor-widget-container > .elementor-heading-title`. The `_css_classes` adds `wnz-headline` to the OUTER `.elementor-element` wrapper, not the inner `<h1>`.

**Fix:** CSS selectors must descend: `.wnz-headline .elementor-heading-title { font-size: ... }`. The same pattern for every widget — see Sec. "CSS-to-widget-DOM map" below.

### data-attr on native widgets gets stripped

**Symptom:** `data-scramble` / `data-magnet` / `data-tilt` set in the build script never appear on the rendered widget.

**Root cause:** Native widgets render their own DOM and don't pass arbitrary HTML attrs.

**Fix:** Use `rolepod_wp_elementor_widget_attribute` (Phase 3.2). Stores per-widget attrs in `_rolepod_widget_attrs` post meta. Companion emits a footer JSON bridge that the theme JS reads + applies attrs to `[data-id="<widget_id>"]` BEFORE effects init. Works automatically.

---

## CSS-to-widget-DOM map (cheat sheet)

For each widget, the THEME CSS selector that targets the inner styled element:

| Widget | Outer wrapper class | Inner styled element |
|---|---|---|
| heading | `.elementor-widget-heading` | `.elementor-heading-title` |
| text-editor | `.elementor-widget-text-editor` | `.elementor-text-editor` (inherits styles) |
| button | `.elementor-widget-button` | `.elementor-button` |
| image | `.elementor-widget-image` | `img` |
| icon | `.elementor-widget-icon` | `.elementor-icon` |
| icon-box | `.elementor-widget-icon-box` | `.elementor-icon-box-wrapper` |
| counter | `.elementor-widget-counter` | `.elementor-counter-number-wrapper` (numbers) + `.elementor-counter-title` (label) |
| accordion | `.elementor-widget-accordion` | `.elementor-tab-title`, `.elementor-tab-content`, `.elementor-accordion-icon` |
| spacer | `.elementor-widget-spacer` | `.elementor-widget-container` |
| divider | `.elementor-widget-divider` | `.elementor-divider-separator` |

Theme stylesheet pattern:

```css
/* outer-class .inner-element { ... } */
.wnz-headline .elementor-heading-title{
  font-family: var(--mono);
  font-size: clamp(40px, 7.2vw, 96px);
}
.wnz-card .elementor-icon-box-wrapper{
  padding: 28px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
}
.wnz-card .elementor-icon{
  width: 44px; height: 44px;
  background: rgba(0,255,209,0.04);
  color: var(--mint);
}
```

---

## Helpers that wrap this for you

- `walnutztudio_e_section`, `_column`, `_heading`, `_text`, `_button`, `_counter`, `_iconbox`, `_accordion`, `_html` — local PHP helpers in the WalnutZtudio `_build/` dir produce the correct JSON shape for each widget. Copy and adapt for other projects.
- `rolepod_wp_elementor_widget_schema(widget: "<type>")` — fetches live control registry. Use to verify a setting key exists on the target's Elementor version.
- `rolepod_wp_elementor_validate_data(sections)` — runs schema-driven validation across the whole tree. Catches type mismatches BEFORE commit.
- `rolepod_wp_elementor_template_export(post_id)` — exports an existing page's `_elementor_data`. Learn from human-built pages.
- `rolepod_wp_elementor_template_apply(target_post_id, sections, ...)` — commits to the target post + sets the Elementor flags.
- `rolepod_wp_elementor_publish(post_id)` — flush-css + cache flush + theme-asset filemtime bump + warm-fetch.
- `rolepod_wp_elementor_html_audit(post_id)` (Phase 6.2) — reports HTML widget % + suggests native alternatives.

---

## Quick reference card

| Pattern in mockup | Use this widget | Don't use |
|---|---|---|
| Headline / page title | `heading` | `html` |
| Paragraph / body copy | `text-editor` | `html` |
| Single CTA | `button` | `html` |
| Stat (animated number) | `counter` | `html` |
| FAQ list | `accordion` | `html` |
| Feature card (icon + title + desc) | `icon-box` | `html` |
| Hero with stats row | `section` + `heading` × 2 + `text-editor` + `button` × 2 + inner-`section` + `counter` × 4 | one big `html` |
| 3-card service grid | `section` (structure=`30`) + 3 columns + `icon-box` per col | one big `html` |
| Pricing card (free) | Best mix: HTML widget per card | one big `html` for whole row |
| Code terminal | `html` (acceptable) | — |
| Marquee strip | `html` (acceptable) | — |
| Image gallery | `image-carousel` or `image-gallery` | `html` |
| Inline icon | `icon` | `html` |
| Visual separator | `divider` | `html` |
| Vertical gap | `spacer` | `html` |
