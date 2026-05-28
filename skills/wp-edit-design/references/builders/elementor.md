---
verified_from: live runtime introspection
elementor_version: 4.1.1
target: srv1475649.hstgr.cloud (demo)
audit_tool: rolepod_wp_cli_run + Plugin::instance()->widgets_manager
verified_widgets: 38 / 149 registered
verified_at: 2026-05-28
---

# Elementor — widget catalog + decision rules

Reference for native-first Elementor page builds. **HTML widget = last resort.**

Widget control names, types, defaults below are pulled from `Plugin::instance()->widgets_manager->get_widget_types()` on a live Elementor 4.1.1 demo target. Universal/promo/responsive-hide controls (`*_pro`, `display_conditions_*`, `scrolling_effects_*`, `mouse_effects_*`, `sticky_*`, `hide_desktop|tablet|mobile`, `custom_attributes_*`, `custom_css_*`, `animation_*`) are dropped from each widget table — they exist on EVERY widget and add no signal here. Re-introspect via `rolepod_wp_elementor_widget_schema` if a project pins a different Elementor version.

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

**Inner section:** same shape, set `isInner: true`. Use inside a column to nest a sub-grid.

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

`_column_size` must add up to 100 across sibling columns.

---

## Widget catalog (verified live)

### `heading` (Heading)

| key | type | default | notes |
|---|---|---|---|
| title | textarea | `Add Your Heading Text Here` | the heading text |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` | wrap heading in `<a>` |
| size | select | `default` | options: `default`, `small`, `medium`, `large`, `xl`, `xxl` |
| header_size | select | `h2` | options: `h1`, `h2`, `h3`, `h4`, `h5`, `h6`, `div`, `span`, `p` |
| title_colors | tabs | — | wrapper for normal/hover color tabs |
| title_colors_normal | tab | — | normal-state color tab |
| title_colors_hover | tab | — | hover-state color tab |

**Coverage:** 100% of headlines. For inline `<em>` mixed-style use two stacked Heading widgets OR a `text-editor`.

### `text-editor` (Text Editor)

| key | type | default | notes |
|---|---|---|---|
| editor | wysiwyg | `<p>Lorem ipsum dolor sit amet, …</p>` | rich HTML body |
| drop_cap | switcher | `""` | `yes` to enable drop-cap |
| link_colors | tabs | — | wrapper |
| colors_normal | tab | — | normal-state link colors |
| colors_hover | tab | — | hover-state link colors |
| drop_cap_view | select | `default` | options: `default`, `stacked`, `framed` |

**Coverage:** 100% of body copy. `wp_kses_post` runs on save — non-allowlisted tags/attrs are stripped.

### `button` (Button)

| key | type | default | notes |
|---|---|---|---|
| button_type | select | `""` | options: `""` (default), `info`, `success`, `warning`, `danger` |
| text | text | `Click here` | button label |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` |  |
| size | select | `sm` | options: `xs`, `sm`, `md`, `lg`, `xl` |
| selected_icon | icons | `{value:"",library:""}` | Font Awesome picker |
| button_css_id | text | `""` | DOM `id` for the `<a>` |
| align | choose | `""` | options: `left`, `center`, `right`, `justify` |
| align_tablet | choose | `""` | responsive |
| align_mobile | choose | `""` | responsive |
| tabs_button_style | tabs | — | normal/hover tab wrapper |
| tab_button_normal | tab | — |  |
| tab_button_hover | tab | — |  |

### `image` (Image)

| key | type | default | notes |
|---|---|---|---|
| image | media | `{url:"",id:"",size:""}` | attachment |
| image_size | select | `large` | options: `thumbnail`, `medium`, `medium_large`, `large`, `full`, `custom` |
| image_custom_dimension | image_dimensions | `{width:"",height:""}` | used when `image_size=custom` |
| caption_source | select | `none` | options: `none`, `attachment`, `custom` |
| caption | text | `""` | shown when `caption_source=custom` |
| link_to | select | `none` | options: `none`, `file`, `custom` |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` | used when `link_to=custom` |
| open_lightbox | select | `default` | options: `default`, `yes`, `no` |
| image_effects | tabs | — |  |
| normal | tab | — | normal-state CSS filter tab |
| hover | tab | — | hover-state CSS filter tab |
| hover_animation | hover_animation | `""` | e.g. `grow`, `shrink`, `pulse`, `float`, `bob` |

### `icon` (Icon)

| key | type | default | notes |
|---|---|---|---|
| selected_icon | icons | `{value:"fas fa-star",library:"fa-solid"}` | picker |
| view | select | `default` | options: `default`, `stacked`, `framed` |
| shape | select | `circle` | options: `circle`, `square`; visible when `view!=default` |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` |  |
| icon_colors | tabs | — |  |
| icon_colors_normal | tab | — |  |
| icon_colors_hover | tab | — |  |
| hover_animation | hover_animation | `""` |  |

### `icon-box` (Icon Box)

| key | type | default | notes |
|---|---|---|---|
| selected_icon | icons | `{value:"fas fa-star",library:"fa-solid"}` |  |
| view | select | `default` | options: `default`, `stacked`, `framed` |
| shape | select | `circle` | options: `circle`, `square` |
| title_text | text | `This is the heading` |  |
| description_text | textarea | `Lorem ipsum dolor sit amet, …` |  |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` | wraps whole box |
| title_size | select | `h3` | options: `h1`–`h6`, `div`, `span`, `p` |
| position | choose | `block-start` | options: `block-start` (top), `inline-start` (left), `inline-end` (right) |
| position_tablet | choose | `""` | responsive |
| position_mobile | choose | `block-start` | responsive |
| icon_colors | tabs | — |  |
| icon_colors_normal | tab | — |  |
| icon_colors_hover | tab | — |  |
| hover_animation | hover_animation | `""` |  |
| icon_box_title_colors | tabs | — |  |
| icon_box_title_colors_normal | tab | — |  |
| icon_box_title_colors_hover | tab | — |  |

**Coverage:** 80% of feature cards. `selected_icon` is Font Awesome only. Multi-line feature lists need a separate Text Editor widget per card.

### `image-box` (Image Box)

| key | type | default | notes |
|---|---|---|---|
| image | media | `{url:"",id:"",size:""}` |  |
| thumbnail_size | select | `full` | options: `thumbnail`, `medium`, `medium_large`, `large`, `full`, `custom` |
| thumbnail_custom_dimension | image_dimensions | `{width:"",height:""}` |  |
| title_text | text | `This is the heading` |  |
| description_text | textarea | `Lorem ipsum dolor sit amet, …` |  |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` |  |
| title_size | select | `h3` | options: `h1`–`h6`, `div`, `span`, `p` |
| position | choose | `top` | options: `top`, `left`, `right` |
| position_tablet | choose | `""` |  |
| position_mobile | choose | `""` |  |
| content_vertical_alignment | choose | `top` | options: `top`, `middle`, `bottom` |
| content_vertical_alignment_tablet | choose | `""` |  |
| content_vertical_alignment_mobile | choose | `""` |  |
| image_effects | tabs | — |  |
| normal | tab | — |  |
| hover | tab | — |  |
| hover_animation | hover_animation | `""` |  |
| image_box_title_colors | tabs | — |  |
| image_box_title_colors_normal | tab | — |  |
| image_box_title_colors_hover | tab | — |  |

### `image-carousel` (Image Carousel)

| key | type | default | notes |
|---|---|---|---|
| carousel_name | text | `Image Carousel` | accessible name |
| carousel | gallery | `[]` | array of `{id, url}` images |
| thumbnail_size | select | `thumbnail` | options: `thumbnail`, `medium`, `medium_large`, `large`, `full`, `custom` |
| thumbnail_custom_dimension | image_dimensions | `{width:"",height:""}` |  |
| slides_to_show | select | `""` | options: `""` (default 3), `1`–`10` |
| slides_to_show_tablet | select | `""` |  |
| slides_to_show_mobile | select | `""` |  |
| slides_to_scroll | select | `""` | options: `""`, `1`–`10` |
| image_stretch | select | `no` | options: `no`, `yes` |
| navigation | select | `both` | options: `both`, `arrows`, `dots`, `none` |
| navigation_previous_icon | icons | `{value:"eicon-chevron-left",library:"eicons"}` |  |
| navigation_next_icon | icons | `{value:"eicon-chevron-right",library:"eicons"}` |  |
| link_to | select | `none` | options: `none`, `file`, `custom` |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` |  |
| open_lightbox | select | `default` | options: `default`, `yes`, `no` |
| caption_type | select | `""` | options: `""` (none), `title`, `caption`, `description` |
| lazyload | switcher | `""` |  |
| autoplay | switcher | `yes` |  |
| pause_on_hover | switcher | `yes` |  |
| pause_on_interaction | switcher | `yes` |  |
| autoplay_speed | number | `5000` | ms |
| infinite | switcher | `yes` | loop carousel |
| effect | select | `slide` | options: `slide`, `fade` |
| speed | number | `500` | transition ms |
| direction | select | `ltr` | options: `ltr`, `rtl` |
| arrows_position | select | `inside` | options: `inside`, `outside` |

### `image-gallery` (Basic Gallery)

| key | type | default | notes |
|---|---|---|---|
| wp_gallery | gallery | `[]` | array of `{id, url}` |
| thumbnail_size | select | `thumbnail` | options: `thumbnail`, `medium`, `medium_large`, `large`, `full`, `custom` |
| gallery_columns | select | `4` | options: `1`–`10` |
| gallery_link | select | `file` | options: `file` (lightbox/file), `attachment`, `none` |
| open_lightbox | select | `default` | options: `default`, `yes`, `no` |
| gallery_rand | select | `""` | options: `""` (no), `rand` |
| image_spacing | select | `""` | options: `""` (default), `custom` |

### `video` (Video)

| key | type | default | notes |
|---|---|---|---|
| video_type | select | `youtube` | options: `youtube`, `vimeo`, `dailymotion`, `videopress`, `hosted` |
| youtube_url | text | `https://www.youtube.com/watch?v=XHOmBV4js_E` |  |
| vimeo_url | text | `https://vimeo.com/235215203` |  |
| dailymotion_url | text | `https://www.dailymotion.com/video/x6tqhqb` |  |
| insert_url | switcher | `""` | when hosted: use external URL instead of media library |
| hosted_url | media | `{url:"",id:"",size:""}` | mp4 attachment |
| external_url | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` | when `insert_url=yes` |
| videopress_url | text | `https://videopress.com/v/ZCAOzTNk` |  |
| start | number | `""` | start time in seconds |
| end | number | `""` | end time in seconds |
| autoplay | switcher | `""` |  |
| play_on_mobile | switcher | `""` |  |
| mute | switcher | `""` |  |
| loop | switcher | `""` |  |
| controls | switcher | `yes` | show player controls |
| showinfo | switcher | `yes` | YouTube/dailymotion: show title/info |
| cc_load_policy | switcher | `""` | YouTube: force CC |
| logo | switcher | `yes` | dailymotion |
| yt_privacy | switcher | `""` | youtube-nocookie |
| lazy_load | switcher | `""` |  |
| rel | select | `""` | YouTube: options `""` (yes), `no` |
| vimeo_title | switcher | `yes` |  |
| vimeo_portrait | switcher | `yes` |  |
| vimeo_byline | switcher | `yes` |  |
| color | color | `""` | YouTube/Vimeo accent |
| download_button | switcher | `""` | hosted only |
| preload | select | `metadata` | options: `metadata`, `auto`, `none` |
| poster | media | `{url:"",id:"",size:""}` | hosted poster image |
| show_image_overlay | switcher | `""` | image-overlay-with-play |

### `divider` (Divider)

| key | type | default | notes |
|---|---|---|---|
| style | select | `solid` | options: `solid`, `double`, `dotted`, `dashed`, `groove` |
| look | choose | `line` | options: `line`, `line_text`, `line_icon` |
| text | text | `Divider` | shown when `look=line_text` |
| html_tag | select | `span` | options: `h1`–`h6`, `div`, `span`, `p` |
| icon | icons | `{value:"fas fa-star",library:"fa-solid"}` | shown when `look=line_icon` |
| color | color | `#000` |  |
| weight | slider | `{size:1,unit:"px",sizes:[]}` | line thickness |
| text_align | choose | `center` | options: `left`, `center`, `right` |
| icon_view | select | `default` | options: `default`, `stacked`, `framed` |
| icon_align | choose | `center` | options: `left`, `center`, `right` |

### `spacer` (Spacer)

| key | type | default | notes |
|---|---|---|---|
| space | slider | `{size:50,unit:"px",sizes:[]}` | vertical height in px/em/% |

### `html` (HTML)

| key | type | default | notes |
|---|---|---|---|
| html | code | `""` | raw HTML/JS/CSS body |

**LAST RESORT.** See "Acceptable use" section below.

### `shortcode` (Shortcode)

| key | type | default | notes |
|---|---|---|---|
| shortcode | code | `""` | a single `[shortcode]` |

Use for CF7, Yoast widgets, custom plugin shortcodes.

### `accordion` (Accordion)

| key | type | default | notes |
|---|---|---|---|
| tabs | repeater | `[{tab_title:"Accordion #1",tab_content:"..."},{tab_title:"Accordion #2",tab_content:"..."}]` | rows: `tab_title` (text), `tab_content` (wysiwyg) |
| selected_icon | icons | `{value:"fas fa-plus",library:"fa-solid"}` | collapsed icon |
| selected_active_icon | icons | `{value:"fas fa-minus",library:"fa-solid"}` | expanded icon |
| title_html_tag | select | `div` | options: `h1`–`h6`, `div`, `span`, `p` |
| faq_schema | switcher | `""` | emit FAQPage JSON-LD |
| icon_align | choose | `left` | options: `left`, `right` |

**Note:** marked `deprecation_message` in 4.1.1 — Elementor steering devs toward `nested-accordion`. Free still ships and renders fine; native legacy bug below stands.

### `toggle` (Toggle)

| key | type | default | notes |
|---|---|---|---|
| tabs | repeater | `[{tab_title:"Toggle #1",tab_content:"..."},{tab_title:"Toggle #2",tab_content:"..."}]` | rows: `tab_title`, `tab_content` |
| selected_icon | icons | `{value:"fas fa-caret-right",library:"fa-solid"}` |  |
| selected_active_icon | icons | `{value:"fas fa-caret-up",library:"fa-solid"}` |  |
| title_html_tag | select | `div` | options: `h1`–`h6`, `div`, `span`, `p` |
| faq_schema | switcher | `""` |  |
| icon_align | choose | `left` | options: `left`, `right` |

### `tabs` (Tabs)

| key | type | default | notes |
|---|---|---|---|
| tabs | repeater | `[{tab_title:"Tab #1",tab_content:"..."},{tab_title:"Tab #2",tab_content:"..."}]` | rows: `tab_title`, `tab_content` |
| type | choose | `horizontal` | options: `horizontal`, `vertical` |
| tabs_align_horizontal | choose | `""` | options: `start`, `center`, `end`, `stretch`; horizontal mode only |
| tabs_align_vertical | choose | `""` | options: `start`, `center`, `end`, `stretch`; vertical mode only |

### `counter` (Counter)

| key | type | default | notes |
|---|---|---|---|
| starting_number | number | `0` |  |
| ending_number | number | `100` |  |
| prefix | text | `""` | e.g. `$` |
| suffix | text | `""` | e.g. `+`, `%` |
| duration | number | `2000` | ms animation length |
| thousand_separator | switcher | `yes` | enable separator |
| thousand_separator_char | select | `""` | options: `""` (comma), `.`, ` ` (space), `'` |
| title | text | `Cool Number` |  |
| title_tag | select | `div` | options: `h1`–`h6`, `div`, `span`, `p` |

**Note:** `num_decimals` exists in some 4.x builds — verify with `widget_schema` before relying on it. Animation triggers on scroll-into-view (IntersectionObserver); full-page screenshots may show 0.

### `progress` (Progress Bar)

| key | type | default | notes |
|---|---|---|---|
| title | text | `My Skill` |  |
| title_tag | select | `span` | options: `h1`–`h6`, `div`, `span`, `p` |
| title_display | switcher | `yes` | show title |
| progress_type | select | `""` | options: `""` (default), `info`, `success`, `warning`, `danger` |
| percent | slider | `{unit:"%",size:50}` | 0–100 |
| display_percentage | switcher | `show` | options: `show`, `hide` |
| inner_text | text | `Web Designer` | text inside the bar |

### `testimonial` (Testimonial)

| key | type | default | notes |
|---|---|---|---|
| testimonial_content | textarea | `Lorem ipsum dolor sit amet, …` | quote body |
| testimonial_image | media | `{url:"",id:"",size:""}` | avatar |
| testimonial_image_size | select | `full` | options: `thumbnail`, `medium`, `medium_large`, `large`, `full`, `custom` |
| testimonial_image_custom_dimension | image_dimensions | `{width:"",height:""}` |  |
| testimonial_name | text | `John Doe` |  |
| testimonial_job | text | `Designer` |  |
| link | url | `{url:"",is_external:"",nofollow:"",custom_attributes:""}` |  |
| testimonial_image_position | choose | `aside` | options: `aside`, `top` |

### `social-icons` (Social Icons)

| key | type | default | notes |
|---|---|---|---|
| social_icon_list | repeater | `[{social:{value:"fab fa-facebook",library:"fa-brands"}},{social:{value:"fab fa-x-twitter",library:"fa-brands"}},{social:{value:"fab fa-youtube",library:"fa-brands"}}]` | rows: `social` (icons), `link` (url), color overrides |
| shape | select | `rounded` | options: `rounded`, `square`, `circle` |
| columns | select | `0` | options: `0` (auto), `1`–`10` |
| columns_tablet | select | `""` |  |
| columns_mobile | select | `""` |  |
| align | choose | `center` | options: `start`, `center`, `end`, `stretch` |
| align_tablet | choose | `""` |  |
| align_mobile | choose | `""` |  |
| icon_color | select | `default` | options: `default`, `custom` |
| hover_animation | hover_animation | `""` |  |

### `alert` (Alert)

| key | type | default | notes |
|---|---|---|---|
| alert_type | select | `info` | options: `info`, `success`, `warning`, `danger` |
| alert_title | text | `This is an Alert` |  |
| alert_description | textarea | `I am a description. Click the edit button to change this text.` |  |
| show_dismiss | switcher | `show` | options: `show`, `hide` |
| dismiss_icon | icons | `{value:"fas fa-times",library:"fa-solid"}` | shown when `show_dismiss=show` |
| dismiss_icon_colors | tabs | — | normal/hover wrapper |
| dismiss_icon_normal_colors | tab | — |  |
| dismiss_icon_hover_colors | tab | — |  |

### `star-rating` (Star Rating)

| key | type | default | notes |
|---|---|---|---|
| rating_scale | select | `5` | options: `5`, `10` |
| rating | number | `5` | actual rating, must be <= scale |
| star_style | select | `star_fontawesome` | options: `star_fontawesome`, `star_unicode` |
| unmarked_star_style | choose | `solid` | options: `solid`, `outline` |
| title | text | `""` | optional label |
| align | choose | `""` | options: `left`, `center`, `right`, `justify` |
| align_tablet | choose | `""` |  |
| align_mobile | choose | `""` |  |

### `menu-anchor` (Menu Anchor)

| key | type | default | notes |
|---|---|---|---|
| anchor | text | `""` | id used as `#anchor` target (no `#`, no spaces) |

### `blockquote` (Blockquote)

Verified registered. No widget-specific controls exposed beyond universal — content is set via inline editor on the rendered element. Skip for programmatic builds; use `text-editor` with a `<blockquote>` tag instead.

### `animated-headline` / `countdown` / `flip-box` / `form` / `nav-menu` / `portfolio` / `posts` / `price-table` / `price-list` / `slides` / `testimonial-carousel` (Pro)

These widgets ARE registered on the 4.1.1 install (149 widgets total) but have NO non-universal controls exposed via the free-tier introspection path — Elementor Pro registers their real control set at runtime. Plan around free, or check `wp plugin list | grep elementor-pro` before using.

### `nested-accordion` (Accordion)

Successor to legacy `accordion`. 109 controls (full styling parity with `nested-tabs`).

| key | type | default | notes |
|---|---|---|---|
| items | repeater (nested) | `[{title:"Item #1",item_id:"...",child_elements:[]}]` | each item has nested element children — true container, not a wysiwyg cell |
| accordion_item_title_icon | icons | `{value:"fas fa-plus",library:"fa-solid"}` |  |
| accordion_item_title_icon_active | icons | `{value:"fas fa-minus",library:"fa-solid"}` |  |
| title_tag | select | `div` | options: `h1`–`h6`, `div`, `span`, `p` |
| faq_schema | switcher | `""` |  |
| default_state | select | `expanded` | options: `expanded`, `all_collapsed` |
| max_items_expended | select | `one` | options: `one`, `multiple` |
| n_accordion_animation_duration | slider | `{size:400,unit:"ms"}` |  |

Plus full background/border/typography control sets per state (normal/hover/active) on `accordion`, `header`, `title`, `icon`. Use this in new builds — legacy `accordion` shows `deprecation_message`.

### `nested-tabs` (Tabs)

Successor to legacy `tabs`. 107 controls.

| key | type | default | notes |
|---|---|---|---|
| tabs | repeater (nested) | `[{tab_title:"Tab #1",tab_id:"...",child_elements:[]}]` | nested container, like nested-accordion |
| tabs_direction | choose | `top` | options: `top`, `bottom`, `start`, `end` |
| tabs_justify_horizontal | choose | `""` | options: `start`, `center`, `end`, `stretch`; horizontal modes only |
| tabs_justify_horizontal_tablet | choose | `""` |  |
| tabs_justify_horizontal_mobile | choose | `""` |  |
| horizontal_scroll | select | `disable` | options: `disable`, `enable` |
| horizontal_scroll_tablet | select | `""` |  |
| horizontal_scroll_mobile | select | `""` |  |
| breakpoint_selector | select | `none` | options: `none`, `mobile`, `tablet` (switch to dropdown UI below this BP) |

Plus full styling parity with `nested-accordion`.

---

## Acceptable / NOT acceptable use of `html` widget

**Acceptable:**

- Terminal block with typer animation (data-typer JSON attribute)
- Marquee strip (no native marquee in free)
- Scramble headline (needs scramble script binding)
- Custom SVG illustrations beyond Font Awesome
- Pricing tier card body (free has no Price Table)
- Mockup-specific compound layouts that would require 10+ native widgets

**NOT acceptable:**

- Plain headings → use `heading`
- Paragraphs → use `text-editor`
- Buttons → use `button`
- Counter stats → use `counter`
- FAQ → use `accordion` or `nested-accordion`
- Feature cards with icon + title + desc → use `icon-box`
- Whole hero/services/process/portfolio/pricing section in one widget → BREAK INTO PIECES

---

## Common gotchas + workarounds (drawn from the WalnutZtudio build)

### Section `_css_classes` doesn't render on the `<section>` tag

**Symptom:** Set `_css_classes: 'wnz-hero'` on a section's settings, the class never appears on the rendered `<section>` tag. Widget-level `_css_classes` works fine.

**Root cause:** Elementor 4.x fires `elementor/frontend/before_render` only for widgets, not sections. The legacy `elementor/element/before_render` only fires in editor / control-panel context.

**Fix:** Shipped in rolepod-wp v2.12.1's `ElementorCompat` class. Uses `elementor/frontend/the_content` filter to post-process the rendered HTML and inject the classes. Works automatically when companion is active.

### Counter widget shows 0 in screenshots

**Symptom:** `rolepod-uiproof` full-page screenshot shows counter at `0` instead of the target value.

**Root cause:** Counter widget animates on scroll-into-view via IntersectionObserver. Full-page screenshot rendering stitches multiple viewports — IO doesn't fire across stitches.

**Fix:** Real user sees correct animation on scroll. For screenshots, scroll to each counter section + wait 1500ms before capture.

### Accordion `icon` setting silently renders "Array"

**Symptom:** `<i class="elementor-accordion-icon-closed Array"></i>` — empty icon space.

**Root cause:** Legacy `icon` control expects a string class (e.g., `"fa fa-plus"`). Passing the new `{value, library}` array shape (used by the modern `selected_icon` field) is silently stringified to `"Array"`.

**Fix:** Pass BOTH `icon` (string) AND `selected_icon` (array). The validator (`rolepod_wp_elementor_validate_data`) catches this before commit. OR switch to `nested-accordion`, which only uses the modern shape.

### Native widget DOM nesting requires CSS scope

**Symptom:** Custom CSS keyed to `.wnz-headline` doesn't style the heading text.

**Root cause:** Elementor wraps the actual `<h1>` in `.elementor-widget-container > .elementor-heading-title`. The `_css_classes` adds `wnz-headline` to the OUTER `.elementor-element` wrapper, not the inner `<h1>`.

**Fix:** CSS selectors must descend: `.wnz-headline .elementor-heading-title { font-size: ... }`. See "CSS-to-widget-DOM map" below.

### data-attr on native widgets gets stripped

**Symptom:** `data-scramble` / `data-magnet` / `data-tilt` set in the build script never appear on the rendered widget.

**Root cause:** Native widgets render their own DOM and don't pass arbitrary HTML attrs.

**Fix:** Use `rolepod_wp_elementor_widget_attribute` (Phase 3.2). Stores per-widget attrs in `_rolepod_widget_attrs` post meta. Companion emits a footer JSON bridge that the theme JS reads + applies attrs to `[data-id="<widget_id>"]` BEFORE effects init.

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
| image-box | `.elementor-widget-image-box` | `.elementor-image-box-wrapper` |
| counter | `.elementor-widget-counter` | `.elementor-counter-number-wrapper` (numbers) + `.elementor-counter-title` (label) |
| progress | `.elementor-widget-progress` | `.elementor-progress-wrapper` + `.elementor-progress-bar` |
| accordion | `.elementor-widget-accordion` | `.elementor-tab-title`, `.elementor-tab-content`, `.elementor-accordion-icon` |
| nested-accordion | `.elementor-widget-n-accordion` | `details`, `summary`, `.e-n-accordion-item` |
| tabs | `.elementor-widget-tabs` | `.elementor-tab-title`, `.elementor-tab-content` |
| nested-tabs | `.elementor-widget-n-tabs` | `.e-n-tabs-heading`, `.e-n-tabs-content` |
| spacer | `.elementor-widget-spacer` | `.elementor-widget-container` |
| divider | `.elementor-widget-divider` | `.elementor-divider-separator` |
| social-icons | `.elementor-widget-social-icons` | `.elementor-social-icon`, `.elementor-icon` |
| alert | `.elementor-widget-alert` | `.elementor-alert` |
| testimonial | `.elementor-widget-testimonial` | `.elementor-testimonial-wrapper` |
| image-carousel | `.elementor-widget-image-carousel` | `.elementor-image-carousel-wrapper` |

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
| FAQ list (new build) | `nested-accordion` | `html` |
| FAQ list (legacy compat) | `accordion` | `html` |
| Feature card (icon + title + desc) | `icon-box` | `html` |
| Image card (image + title + desc) | `image-box` | `html` |
| Hero with stats row | `section` + `heading` × 2 + `text-editor` + `button` × 2 + inner-`section` + `counter` × 4 | one big `html` |
| 3-card service grid | `section` (structure=`30`) + 3 columns + `icon-box` per col | one big `html` |
| Pricing card (free) | Best mix: `icon-box` head + `text-editor` body + `button` foot | one big `html` for whole row |
| Tabs interface | `nested-tabs` (new) or `tabs` (legacy) | `html` |
| Code terminal | `html` (acceptable) | — |
| Marquee strip | `html` (acceptable) | — |
| Image gallery | `image-carousel` or `image-gallery` | `html` |
| Image slider | `image-carousel` | `html` |
| Inline icon | `icon` | `html` |
| Visual separator | `divider` | `html` |
| Vertical gap | `spacer` | `html` |
| Testimonial | `testimonial` (single) | `html` |
| Star rating | `star-rating` | `html` |
| Progress bar | `progress` | `html` |
| Alert box | `alert` | `html` |
| Social icons row | `social-icons` | `html` |
| Section anchor (`#contact`) | `menu-anchor` | `html` |
