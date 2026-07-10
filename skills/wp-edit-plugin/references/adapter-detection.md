# Adapter detection + REST surface

How each adapter detects its plugin, where the writes go, and the per-plugin quirks.

## Yoast SEO (`wp_yoast_*`)

**Detection:**
- REST namespace `yoast/v1` present in `/wp-json/`.
- Plugin file: `wordpress-seo/wp-seo.php` active.

**Scopes:**
- `post_meta` (requires `post_id`) → focus keyword + meta description + title + canonical + noindex.
- `settings` → titles + schema config.

**Writes:** `yoast/v1/meta` POST for post-level; `yoast/v1/configuration` for settings.

**Quirks:**
- Yoast Premium adds `yoast_premium/v1` — free version returns 404 for premium endpoints.
- Sitemap rebuild fires on first write per post; subsequent writes are cheap.
- Setting `noindex: true` does NOT remove from sitemap automatically; explicit sitemap exclusion needed.

## Rank Math (`wp_rankmath_*`)

**Detection:**
- REST namespace `rankmath/v1` present.
- Plugin file: `seo-by-rank-math/rank-math.php` active.

**Scopes:**
- `post_meta` (requires `post_id`) → focus keyword + meta description + title.
- `settings` → titles + schema.

**Writes:** `rankmath/v1/saveMeta` POST.

**Quirks:**
- Rank Math stores in `rank_math_*` postmeta keys; raw `postmeta` calls work but skip the schema autocompute hook.
- Two SEO plugins on one site → adapter takes the first that returns `detected: true`; user should disable the loser.

## WPML (`wp_wpml_*`)

**Detection:**
- REST namespace `wpml/v1` present.
- Plugin file: `sitepress-multilingual-cms/sitepress.php` active.
- Licence: WPML requires a paid licence for REST writes; adapter surfaces the licence error verbatim.

**Scopes:**
- `languages` → list configured languages.
- `translations` (requires `post_id` + `target_language`) → read or create translation link.
- `current` → currently active language for the request.

**Writes:** `wpml/v1/translations` POST creates a translation post + links it to the source.

**Quirks:**
- WPML stores translation links in `icl_translations` table — NOT postmeta. Raw DB writes here corrupt the trid map.
- A translated post shares the `trid` (translation group ID) with its source; deleting the source orphans translations.
- Free alternatives (Polylang, qTranslate) are NOT detected by this adapter — that is by design; their data shapes differ.

## WooCommerce (`wp_woo_*`)

**Detection:**
- REST namespace `wc/v3` present.
- Plugin file: `woocommerce/woocommerce.php` active.

**Scopes (read):** products / orders / settings_groups / settings_in_group / shipping_zones / payment_gateways.
**Scopes (write):** products + variations + coupons + orders + tax_rates + shipping_zone_methods + bulk price updates.

**Writes:** `wc/v3/<resource>` per Woo REST docs.

**Quirks:**
- Bulk price updates: prefer `wc/v3/products/batch` (atomic across a batch) over loop of singles.
- Settings groups require fetching `settings_groups` first to discover IDs (e.g. `general`, `tax`, `shipping`).
- Variable products need `variations` written separately AFTER the parent product is created — the parent does not inline-create variations.

## ACF (`wp_acf_*`)

**Detection:**
- ACF free has NO native REST namespace. Adapter falls back to detecting `acf-field-group` post_type via core REST.
- ACF Pro exposes `acf/v3` — full REST surface.
- Plugin file: `advanced-custom-fields/acf.php` (free) OR `advanced-custom-fields-pro/acf.php` (Pro).

**Scopes:**
- `field_groups` → list registered field groups.
- `fields_in_group` (requires `group_key`) → fields inside a group.
- `post_meta` (requires `post_id`) → ACF values on a post.

**Writes:**
- Pro: `acf/v3/<post_type>/<post_id>` direct.
- Free: write via `postmeta` direct on `wp_postmeta` (no REST). Adapter handles the shim.

**Quirks:**
- Detection on the CURRENT companion v2.1+ uses post_type probe — works on free + Pro. Earlier MCP builds (v1.3) failed on free version.
- ACF field keys are `field_<hex>` — adapter resolves human-readable names to keys.

## Forms (`wp_forms_*`) — Gravity / CF7 / WPForms

**Detection (auto, in order):**
1. Gravity Forms → REST namespace `gf/v2`. Plugin: `gravityforms/gravityforms.php`.
2. WPForms Pro → REST namespace `wpforms/v1`. Plugin: `wpforms/wpforms.php`.
3. Contact Form 7 → REST namespace `contact-form-7/v1`. Plugin: `contact-form-7/wp-contact-form-7.php`.

**Scopes:**
- `list_forms` → enumerate forms.
- `form_detail` (requires `form_id`) → fields + settings.
- `list_entries` → Gravity only in v1.1 (CF7 has no entries by design, WPForms entries deferred to v1.2).

**Writes (v1.1):** Gravity + WPForms only. CF7 form definitions live in `wp_posts` (`type=wpcf7_contact_form`) — write via `wp-content` (core REST) instead.

**Quirks:**
- Gravity Forms writes go through wp-cli (`wp gf ...`), not the GF REST API. There is no `GF_REST_KEY` / `GF_REST_SECRET` support; do not ask the user for API keys.
- WPForms free has read-only REST; Pro unlocks writes.
- Form `id` formats differ: Gravity uses int, CF7 uses post ID, WPForms uses int — adapter routes the right format per engine.
