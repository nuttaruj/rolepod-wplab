---
verified_from: mixed
elementor_recipes: live-verified (Elementor 4.1.1 on demo target, 2026-05-28)
gutenberg_recipes: live-verified (WP 7.0 on demo target, 2026-05-28)
bricks_recipes: docs-and-ai-memory (Bricks 2.x docs, not live-verified)
divi_recipes: docs-and-ai-memory (Divi 4.x/5.x docs, not live-verified)
oxygen_recipes: docs-and-ai-memory (Oxygen 4.x docs, not live-verified)
verified_at: 2026-05-28
---

# Mockup pattern → builder recipe map

Builder-agnostic recipe library. Each pattern maps a recurring mockup visual
to the canonical builder recipe. AI must look here BEFORE deciding to use a
raw HTML widget.

> **Accuracy note:** Elementor + Gutenberg recipes match live-verified widget/block names. Bricks / Divi / Oxygen recipes are derived from public docs + AI memory and have NOT been live-verified — confirm element names against the actual project target before depending on a specific recipe.

## How to read a recipe

Each pattern has:

- `id` — stable slug
- `description` — when this pattern applies
- `<builder>_recipe` — ordered list of widgets/elements to compose
- `css_pairs` — theme CSS selectors that map the widget DOM to the mockup design
- `rule` — hard constraint (e.g., "NEVER use one HTML widget for the whole hero")
- `quirks` — known bugs/workarounds for the relevant builder
- `html_widget` — `required` only when no native widget can express the pattern

---

## P-001 — Hero (headline + sub + CTA + stats)

**description:** Bold headline, sub-paragraph below, 1-2 CTAs, optional 4-column stat row at the bottom.

### Elementor recipe

```
section (structure: 10, css_classes: "wnz-hero")
├── heading (h1, css_classes: "wnz-hero-h1", title: "Line 1")
├── heading (h1, css_classes: "wnz-hero-h1 wnz-hero-h1-em", title: "Line 2 with gradient")
├── text-editor (css_classes: "wnz-hero-sub", editor: "<p>...</p>")
├── html (css_classes: "wnz-hero-cta-row", inline buttons or:)
│   ├── button (text: "Primary CTA", css_classes: "wnz-btn")
│   └── button (text: "Ghost CTA", css_classes: "wnz-btn ghost")
└── inner-section (structure: 40, isInner: true, css_classes: "wnz-hero-stats")
    └── 4 × column → counter widget per column
```

### CSS pairs

```css
.wnz-hero-h1 .elementor-heading-title{ font-family: var(--mono); font-size: clamp(40px, 7.2vw, 96px); max-width: 760px; }
.wnz-hero-h1-em .elementor-heading-title{ background: linear-gradient(120deg, var(--mint), var(--violet)); -webkit-background-clip: text; color: transparent; }
.wnz-hero-sub .elementor-text-editor p{ max-width: 560px; color: var(--text-dim); }
.wnz-hero-stats > .elementor-container{ display: grid; grid-template-columns: repeat(4, 1fr); border-top: 1px solid var(--line); padding-top: 32px; margin-top: 56px; }
```

### Rule

NEVER put hero into a single HTML widget. The headline + sub + CTAs + stats are independent widget types; user must be able to swap headline copy + counter values via the Elementor UI.

### Bricks / Divi / Gutenberg equivalents

- **Bricks:** Container + Heading + Heading + Basic Text + Button × 2 + Container (4-col) + Counter × 4
- **Divi:** Row (1col) + Text Module (h1) + Text Module (h1 with custom CSS) + Text Module (p) + Button × 2 + Row (4-col) + Number Counter × 4
- **Gutenberg:** Group (cover OR group) + Heading + Heading + Paragraph + Buttons block + Columns (4) + Custom "counter" block (no core block — use a plugin like Ultimate Blocks or write a custom block via `wp-scaffold`)

---

## P-002 — Feature grid (icon + title + desc cards)

**description:** 3-6 cards in a grid, each with an icon, title, paragraph, optional price tag.

### Elementor recipe

```
section (structure: 30)
└── 3 × column (size: 33)
    └── icon-box (selected_icon, title_text, description_text, css_classes: "wnz-card wnz-tilt")
```

For grids > 3 columns, use a 4-column or 6-column structure OR stack multiple 3-column sections.

For feature lists below the description (e.g., bullet list of capabilities) use icon-box + a text-editor widget in the same column:

```
column (size: 33)
├── icon-box (icon + title + main description, css_classes: "wnz-card-head")
└── text-editor (editor: "<ul><li>...</li></ul>", css_classes: "wnz-card-feats")
```

### CSS pairs

```css
.wnz-card .elementor-icon-box-wrapper{ padding: 28px; border: 1px solid var(--line); border-radius: var(--radius); background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent); }
.wnz-card .elementor-icon{ width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 10px; background: rgba(0,255,209,0.04); color: var(--mint); }
.wnz-card .elementor-icon-box-title{ font-family: var(--mono); font-size: 22px; }
.wnz-card .elementor-icon-box-description{ color: var(--text-dim); font-size: 14px; }
```

### Rule

USE icon-box, NOT one big HTML widget. User must be able to swap each card's icon/title/desc via the Elementor UI per card.

### When to fall back to HTML widget per card

If the card needs more than icon + title + desc + 1 paragraph (e.g., a list of features + price tag + multiple CTAs), do ONE HTML widget per card column (NOT one for the whole grid). Each card stays editable on its own.

---

## P-003 — FAQ accordion

**description:** Vertical list of collapsible Q&A items.

### Elementor recipe

```
section (structure: 10)
└── accordion (tabs: [ {tab_title, tab_content}, ... ], icon: "fa fa-plus", icon_active: "fa fa-minus", icon_align: "right")
```

### CSS pairs

```css
.wnz-faq .elementor-accordion-item{ border-bottom: 1px solid var(--line); background: transparent; }
.wnz-faq .elementor-tab-title{ padding: 20px 0; font-family: var(--mono); font-size: 16px; }
.wnz-faq .elementor-tab-content{ color: var(--text-dim); font-size: 14px; line-height: 1.7; }
/* Display-none fallback in case Elementor's init JS is late */
.wnz-faq .elementor-tab-content{ display: none; }
.wnz-faq .elementor-tab-content.elementor-active{ display: block !important; }
```

### Quirks

- Legacy `icon` field is a STRING, not an array — `"fa fa-plus"` not `{value, library}`. Pass both `icon` (string) AND `selected_icon` (array) for safety. The validator catches mismatches.
- Default render lacks `display:none` reset — add CSS above.

### Rule

USE accordion. Never an HTML widget with `<details>/<summary>`. Native gives the user a proper "Add new question" button in the Elementor editor.

---

## P-004 — Stat row (4 animated numbers)

**description:** 4 counters in a row, often inside a hero or as a standalone metrics block.

### Elementor recipe

```
section (structure: 40, css_classes: "wnz-metrics")
└── 4 × column → counter widget (ending_number, prefix?, suffix?, title, num_decimals?)
```

### CSS pairs

```css
.wnz-metrics .wnz-counter .elementor-counter-number-wrapper{ font-family: var(--mono); font-size: 42px; background: linear-gradient(180deg, var(--text), var(--text-mute)); -webkit-background-clip: text; color: transparent; }
.wnz-metrics .wnz-counter .elementor-counter-title{ font-family: var(--mono); font-size: 11px; color: var(--text-mute); text-transform: uppercase; letter-spacing: 0.1em; }
```

### Rule

USE counter widget. NEVER plain HTML number text — counter animates on scroll which is the visual hook.

---

## P-005 — Pricing cards (3 tiers, middle featured)

**description:** Row of 3 pricing cards, middle has visual emphasis (mint border, glow, "Most popular" ribbon).

### Elementor recipe

**Pro:** `price-table` widget × 3 in a 3-column section.

**Free workaround:**

```
section (structure: 30, css_classes: "wnz-pricing-row")
└── 3 × column
    └── html widget (css_classes: "wnz-tier" or "wnz-tier featured", content: full tier card markup)
```

Yes, this IS an HTML widget per card. Rationale: Elementor Free has no Price Table, and emulating a tier card with icon-box + text-editor + button loses the "Most popular" ribbon + feature list + amount/unit visual hierarchy. The tier card is a compound pattern that justifies an HTML widget — but ONE PER TIER, never one for the whole row.

### Rule

HTML widget PER CARD is acceptable. HTML widget for the WHOLE 3-tier row is NOT.

### Alternative

If the target has Elementor Pro, switch to `price-table` widget × 3 with proper settings. Inspect via `rolepod_wp_elementor_widget_schema("price-table")`.

---

## P-006 — Process / steps row

**description:** Row of 3-5 step cards, each with a number/index, short title, paragraph.

### Elementor recipe

```
section (structure: 40, css_classes: "wnz-process")
└── 4 × column
    └── icon-box OR text-editor widget per column
```

For a numbered process (`step_01`, `step_02`, ...) use icon-box with the `view: framed` and `selected_icon: {value: "fas fa-1"}` style OR a text-editor with custom HTML.

### Rule

USE icon-box OR text-editor per step. NEVER one HTML widget for the whole row.

---

## P-007 — Portfolio grid (project cards)

**description:** 3-12 cards showing project thumbnails with title + category overlay.

### Elementor recipe

**Pro:** `portfolio` widget with filterable categories.

**Free workaround:**

```
section (structure: 30 or 40)
└── per column → image-box widget (image, title, description) OR html widget per card if the card has decorative pattern background + hover effects
```

### Rule

If thumbnails are real photos, use image-box. If the cards have decorative gradient patterns + tone variants (like WalnutZtudio's tone-a/tone-b/tone-c), HTML widget per card is acceptable but the GRID must be a native section + columns.

---

## P-008 — Marquee strip (horizontal scrolling logos/text)

**description:** Continuous horizontal scrolling strip of tech logos or brand names.

### Elementor recipe

```
section (structure: 10, css_classes: "wnz-marquee", full-width)
└── html widget (marquee container + track + items)
```

### Rule

HTML widget REQUIRED. No native marquee in Elementor Free. Pro has a marquee addon in some bundles — check via `rolepod_wp_elementor_widget_inventory`.

---

## P-009 — Terminal block

**description:** Code terminal with typed-out commands (caret animation, syntax-colored output).

### Elementor recipe

```
html widget (full terminal markup + data-typer JSON attribute for theme JS)
```

### Rule

HTML widget REQUIRED. No native terminal widget. Use `rolepod_wp_elementor_widget_attribute` to register the data-typer attribute so the theme JS rehydrates it on the rendered widget.

---

## P-010 — Big CTA block (full-bleed dark card)

**description:** Single dark block with gradient bg, headline, paragraph, 2 CTAs, side rail of contact info.

### Elementor recipe

```
section (structure: 23 or 32, css_classes: "wnz-cta")
├── column (size: 58)
│   ├── html (chip/tag widget)
│   ├── heading (h2)
│   ├── text-editor (paragraph)
│   └── 2 × button (mailto, schedule)
└── column (size: 42)
    └── html or text-editor (contact list)
```

### CSS pairs

```css
.wnz-cta > .elementor-container{ border-radius: var(--radius-lg); padding: 64px 48px; background: radial-gradient(...); }
```

### Rule

NATIVE for left column (heading + text + buttons). HTML acceptable for right rail (decorative list with custom inline styles).

---

## P-011 — Header navigation

**description:** Top navigation with logo + nav links + CTA button.

### Recommendation

DO NOT build the header in Elementor (Pro Header Theme Builder excluded). Build via theme's `header.php` template part. Elementor section for body content only.

WalnutZtudio uses the child theme's `template-parts/header/site-header.php` — same pattern. Better for performance and editability via theme rather than Elementor.

---

## P-012 — Footer

**description:** Multi-column footer with brand + link columns + status row.

### Recommendation

Same as header. Build via theme's `footer.php`. Elementor section for body content only.

---

## Decision flowchart

For each mockup section, follow this order:

```
1. Look up pattern by description in this file.
   - Match found? → Use the recipe. Done.
2. No pattern match? → Open elementor.md (or bricks.md / divi.md / gutenberg.md).
   - Find a widget that covers ≥70% of the visual.
   - Compose section + column + that widget + custom CSS class.
3. No native widget fits? → HTML widget per card (NOT per section).
4. Mockup section has no internal structure (single decorative block like terminal)?
   - One HTML widget for the whole section is acceptable.
5. After build:
   - Run rolepod_wp_elementor_validate_data
   - Run rolepod_wp_elementor_html_audit
   - If HTML widget count > 30% of total widgets → refactor.
```

---

## Anti-patterns (NEVER do these)

| ❌ Don't | ✅ Do instead |
|---|---|
| One HTML widget = entire hero with headline + sub + CTAs + stats | Decompose: heading × 2, text-editor, button × 2, inner-section + counter × 4 |
| One HTML widget = whole 6-card services grid | Section structure=`30` + 6 columns + icon-box per column |
| One HTML widget = whole 3-tier pricing row | 3 columns + HTML widget PER tier card |
| One HTML widget = whole FAQ | accordion with tabs array |
| HTML widget for plain headline | heading widget |
| HTML widget for plain paragraph | text-editor widget |
| HTML widget for plain CTA button | button widget |
| HTML widget for stat number | counter widget |
| HTML widget with `data-scramble` baked in | Native widget + `rolepod_wp_elementor_widget_attribute` to register the data attr |
| `_css_classes` rule keyed to section but applied to widget DOM | Read CSS-to-widget-DOM map in elementor.md — selectors must descend into `.elementor-<part>` |

---

## Pattern coverage status

| Pattern | Elementor | Bricks | Divi | Gutenberg |
|---|---|---|---|---|
| P-001 Hero | ✅ | ✅ | ✅ | partial (no native counter) |
| P-002 Feature grid | ✅ | ✅ | ✅ | ✅ |
| P-003 FAQ | ✅ | ✅ | ✅ | ✅ |
| P-004 Stat row | ✅ | ✅ | ✅ | partial |
| P-005 Pricing | ✅ Pro / ⚠️ Free | ✅ | ✅ | ⚠️ |
| P-006 Process | ✅ | ✅ | ✅ | ✅ |
| P-007 Portfolio | ✅ Pro / ⚠️ Free | ✅ | ✅ | partial |
| P-008 Marquee | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| P-009 Terminal | ⚠️ HTML | ⚠️ HTML | ⚠️ HTML | ⚠️ HTML |
| P-010 Big CTA | ✅ | ✅ | ✅ | ✅ |
| P-011 Header | theme template | theme template | Divi Theme Builder | block themes |
| P-012 Footer | theme template | theme template | Divi Theme Builder | block themes |

Legend: ✅ native covers · ⚠️ HTML widget acceptable · partial = needs custom block/widget.
