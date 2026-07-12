---
name: wp-edit-plugin
description: Read or write configuration owned by SEO / i18n / e-commerce / custom-field / forms plugins — Yoast, RankMath, WPML, WooCommerce, ACF, Gravity / CF7 / WPForms — on a connected target. Phase = Build.
when_to_use: user wants to set SEO meta, manage Woo products/orders/settings, manage WPML translations, edit ACF fields, create/edit forms (any flavor), OR mentions any of those plugin names
tier: 1
phase: build
mode:
  standalone:
    role: edit + guide + verify in one flow
    output: edit diff + impact analysis + verification suggestion
  with-rolepod:
    role: WP edit primitive
    caller: rolepod:implement-plan
    output: edit diff only (parent owns verify/review phases)
---

## Mode selection

If the marker file `$GIT_ROOT/.rolepod/parent-active` exists, follow the
**with-rolepod** mode — return the edit diff only. The parent's
`implement-plan` owns verify + review; do not re-run them here.

Otherwise, follow **standalone** mode — edit + impact analysis + verification
suggestion in one flow.

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || GIT_ROOT="$PWD"
if [ -f "$GIT_ROOT/.rolepod/parent-active" ]; then
  MODE=with-rolepod
else
  MODE=standalone
fi
```

# WP Edit Plugin

Plugin-specific config writes. Each adapter detects its plugin (REST namespace probe), reads the current state, writes through the plugin's own REST surface (no direct postmeta — that misses plugin-side hooks). Auto-picks the right adapter when multiple plugins of the same family are installed.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER write Yoast post meta via raw `postmeta` calls — Yoast's REST has hooks for analysis recompute + sitemap rebuild; raw writes desync the indexer.
2. NEVER write Woo products via core `wp/v2/posts` with `type=product` — `/wc/v3/products` runs Woo-side hooks (price index, attribute lookup, stock cache) that the core endpoint skips.
3. ALWAYS check `detected: true` in the adapter response before chaining a write — adapters return `detected: false` cleanly when the plugin is inactive; writing against a `false` detection throws inscrutable errors at the plugin layer.
4. NEVER issue a WooCommerce refund through `rolepod_wp_rest_request` — raw writes to `/wc/v*/orders|refunds|coupons` are sealed (WC_MONEY_ENDPOINT_BLOCKED) because a raw refund POST defaults `api_refund=true` and moves real money. Use `rolepod_wp_woo_write(op: create_refund)`, which defaults `api_refund=false` (records the refund WITHOUT touching the gateway); a real gateway refund needs BOTH `api_refund=true` AND `confirm=true` (MONEY_OP_NEEDS_CONFIRM).
</EXTREMELY-IMPORTANT>

## When to use

- "Set SEO title/description for page X" (Yoast or RankMath)
- "Add a WooCommerce product / list orders / change shipping zones"
- "Link the English page to the Thai translation" (WPML)
- "Add an ACF field group" / "set custom field value"
- "Create a contact form" (CF7 / Gravity / WPForms)

Skip when:

- The content is core (post title/content) → `wp-content`.
- The change is a visual layout (Elementor JSON, theme.json) → `wp-edit-design`.

## Boundary

Owns:

- `rolepod_wp_yoast_{read,write}` — Yoast SEO.
- `rolepod_wp_rankmath_{read,write}` — Rank Math.
- `rolepod_wp_wpml_{read,write}` — WPML translations.
- `rolepod_wp_woo_{read,write}` — WooCommerce.
- `rolepod_wp_acf_{read,write}` — Advanced Custom Fields.
- `rolepod_wp_forms_{read,write}` — Gravity / CF7 / WPForms.

Does not own:

- Core REST CRUD → `wp-content`.
- Layout writes → `wp-edit-design`.
- Plugin BOOTSTRAP (creating a brand-new plugin) → `wp-scaffold`.

Return / hand off:

- The required plugin is not active → tell user to install via REST `wp/v2/plugins` + activate, or via wp-admin.
- The user needs a page wrap → after meta write, hand off to `wp-content` for the page itself.

## Inputs to gather

- target_id.
- For SEO: `post_id` (for post_meta scope) OR no scope (settings).
- For Woo: `scope` (products / orders / settings_groups / settings_in_group / shipping_zones / payment_gateways).
- For ACF: `scope` (field_groups / fields_in_group + group_key / post_meta + post_id).
- For WPML: `scope` (languages / translations / current).
- For Forms: `engine` (auto / gravity / cf7 / wpforms) + `scope` (list_forms / form_detail + form_id / list_entries).

## Workflow

### 1. Detect

Call `*_read` first with the relevant scope. If `detected: false` → STOP, tell user to activate the plugin. See `references/adapter-detection.md` for the per-adapter signal.

### 2. Read current state

For writes that update an existing entity: read first. For new-entity creates: skip read, proceed to write.

### 3. Show diff (writes)

Describe the change in plain text. Wait for user OK if the change touches user-visible config (Yoast title appears in search, Woo prices appear in checkout, WPML link affects routing).

### 4. Write through the adapter

The adapter call surfaces the plugin's native validation errors with their codes intact — do not catch and recoerce.

### 5. Verify

- Yoast / RankMath: read back the post_meta scope, confirm title/description.
- Woo: list the resource just edited.
- ACF: read field_groups, confirm the new group is present.
- WPML: read the translation pair, confirm the link.
- Forms: read form_detail.

## If a matching Rolepod agent is available

- `rolepod:content-strategist` for SEO copy quality (Yoast / RankMath).
- `rolepod:billing-engineer` for Woo pricing / payment-gateway tuning.

## If no matching agent is available

1. Pick the adapter by user intent.
2. Read for detection.
3. Diff or new-create.
4. Write.
5. Verify by reading back.

## Output

No durable artifact. The plugins persist their own state; the MCP returns the freshly-read value as confirmation.

## Examples

No examples file. The per-adapter request shapes mirror each plugin's REST docs directly.

## References

Load before the FIRST write for any given plugin family on this target:

- `references/adapter-detection.md` — per-adapter detection signal, REST namespace, scopes table, common pitfalls (ACF Pro vs free, WooCommerce settings group ordering, WPML licence detect).

## Hard stops

- `detected: false` → STOP. Tell user "the <plugin> plugin is not active on this site; install + activate, then retry."
- Adapter returns an HTTP error from the plugin's own REST (e.g. Woo `woocommerce_rest_invalid_id`) → STOP, surface verbatim; do not retry with mutated input.
- WPML `*_write` without an active WPML licence → STOP, surface the licence message verbatim; do not silently fall back to Polylang or qTranslate.

## Full Rolepod enhancement

Full Rolepod adds bulk SEO meta updates (batch Yoast writes across N posts in one composite call); standalone, batch by iteration.

## Next phase

- After Yoast/RankMath → `wp-health-check` and confirm the new metas reach the sitemap.
- After Woo product writes → list-via-read to confirm stock + index update.
- After WPML translation link → `wp-content` for the actual translated content body.
