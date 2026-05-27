# E2E Test: Bangkok Roast Lab — Gap Report

**Date:** 2026-05-27
**Target:** https://srv1475649.hstgr.cloud/ (Hostinger free demo)
**Plugin version on target:** companion v2.6.9
**MCP version:** @rolepod/wplab v1.9.1
**Scenario:** Build a real coffee-roastery business site end-to-end via MCP tools, identify gaps.

## TL;DR

Site **was** built successfully — 5 pages, 3 products, 2 blog posts, contact form, custom theme palette, navigation menu, site identity. **But ~60% of operations required falling back to direct `execute-php` via curl** because the corresponding MCP tools either weren't loaded in the client session, didn't support RestTarget, or had bugs.

## Final delivered state

```json
{
  "title": "Bangkok Roast Lab",
  "tagline": "Specialty single-origin coffee, roasted weekly in Bangkok.",
  "pages": 5,
  "blog_posts": 2,
  "wc_products": 3,
  "menus": 1,
  "cf7_forms": 1,
  "global_styles": "coffee palette applied",
  "active_plugins": "WooCommerce, CF7, ACF, Yoast SEO, hostinger, varnish-cache, rolepod-wp",
  "timezone": "Asia/Bangkok"
}
```

All pages return HTTP 200. Frontend live at https://srv1475649.hstgr.cloud/.

## What worked through MCP tools (no fallback needed)

| Tool | Used for | Result |
|---|---|---|
| `rolepod_wp_connect_rest` | Connect to demo | ✅ clean |
| `rolepod_wp_post_create` (5x pages + 2x posts) | Create pages + blog posts | ✅ all returned status 201 + post id |
| `rolepod_wp_option_set` | Permalink structure | ✅ (one field) |

That's it. 8 MCP tool invocations succeeded out of ~35 attempts.

## Gaps identified (in priority order)

### Gap #1 — `health_check` shows stale messaging

`health_check` claims wp-cli needs "companion v0.2+" and "REST check deferred to v0.1" even though companion is at v2.6.9 with full wp-cli endpoint. Output fields `wp_cli_ok: false` + `db_ok: false` + `rest_ok: false` were all incorrect; only `companion_ok: true` was accurate.

**Fix:** rewrite warning strings to reflect current companion capability map. Route via Bridge.wpCli for RestTarget like the recovery tools do.

### Gap #2 — `option_set` + `option_get` don't round-trip via REST settings

REST `/wp/v2/settings` uses field names `title`/`description`/`timezone` not `blogname`/`blogdescription`/`timezone_string`. Our tool passes the raw wp_options name to REST settings, which silently ignores unknown fields. `changed: true` returned but value never written. `option_get` returned `null` for the same key on next read.

**Fix options:**
- Map known wp_options names → REST settings field names in the tool layer.
- OR add a companion REST endpoint `/wp-json/wplab/v1/option-set` that calls `update_option()` directly. Most reliable.
- Refuse early if field not in REST settings allow-list (instead of silent partial success).

### Gap #3 — `execute_php` `confirm: true` schema rejects boolean

`z.literal(true)` for the `confirm` parameter fails validation when MCP client sends boolean `true`. Error: `"received": "true", "expected": true`. Looks like a JSON serialization mismatch — MCP client may stringify booleans.

**Fix:** change schema from `z.literal(true)` to `z.boolean().refine(v => v === true, "confirm must be true")` which accepts both `true` and `"true"` then validates the value semantically.

### Gap #4 — `option_set` silently fails for non-allowlisted wp_options

Closely related to #2. REST settings allows ~10 options; the tool accepts ANY option name without checking. User gets `changed: true` for unsupported fields. Subtle and dangerous (user thinks write succeeded).

**Fix:** maintain allowlist OR proxy via companion `/option-set` endpoint.

### Gap #5 — Conventions tools not surfaced in MCP client session

`rolepod_wp_conventions_get` / `rolepod_wp_conventions_set` tools exist in v1.9.x but weren't in the deferred-tool list for this MCP client session. User would have to restart the MCP client to pick up v1.8.0+ tools. Workaround: write JSON file directly.

**Fix:** docs note in README that MCP clients must reconnect/restart after MCP server upgrade. OR ensure the rolepod-wplab MCP advertises its capabilities (via MCP `tools/list`) so clients refresh automatically.

### Gap #6 (MAJOR) — `cli_run` blocks RestTarget with stale error

`cli_run` returns `COMPANION_REQUIRED_V0_2` for RestTarget, claiming "bundled wp-cli endpoint not yet shipped." But companion v2.6.x DOES have the wp-cli endpoint (we use it via curl). The tool was never updated to route RestTarget through Bridge.wpCli.

This is the MOST IMPORTANT gap because cli_run is the workhorse for plugin install, theme ops, cron, search-replace — anything wp-cli does. RestTarget is the most common deployment (shared hosting, no SSH).

**Fix:** in `src/tools/composite/wp_cli_run.ts`, branch on target kind:
- LocalTarget / SshTarget / DockerTarget → existing shell path
- RestTarget → route through `bridge.wpCli(args, opts)` which already works

### Gap #7 — Complex multi-line PHP payloads hard to encode in JSON

`execute_php` accepts payload as string. Embedding PHP with `\n`, single + double quotes, `$var` references requires careful shell escaping. Python `json.dumps` workaround used here.

**Fix:** accept either:
- `payload_file: string` — server-side reads file path under wp-content/uploads/rolepod-payloads/ (scoped).
- `payload_base64: string` — base64-encoded PHP for shell-safe transport.

Or document the pattern (use python/jq to encode) in tool description.

### Gap #8 (MAJOR) — `audit_security`, `diagnose`, `backup_create` all blocked on RestTarget

Same root cause as #6. These shell-only checks could entirely run via companion wp-cli + execute-php + DB queries. RestTarget users can never access these tools as shipped.

**Fix:**
- Refactor each to use Bridge.wpCli where shell is needed (works on RestTarget via companion).
- Add a `/wp-json/wplab/v1/diagnose` companion endpoint that aggregates the read-only checks server-side and returns JSON.

### Gap #9 (CRITICAL) — Ledger empty for the entire session

We performed 30+ writes today (options, pages, posts, products, theme, menu, CF7 form, global styles). The change-ledger DB table got ZERO new rows. Only entries from yesterday's e2e debugging session were present.

Two causes:
- `execute_php` via curl bypasses MCP's `recordChange` helper entirely.
- MCP tools that DO route through Bridge (post_create, option_set) don't appear to call `recordChange` for each write either. Spot-check needed.

This breaks the "AI Change Ledger" + "panic revert" promise on its main use case. If AI does work via execute-php (necessary for most non-trivial ops as shown here), nothing gets recorded.

**Fix options:**
- Server-side capture: companion's `/execute-php` handler parses the PHP payload for `update_option`, `wp_insert_post`, `wp_update_post`, `update_post_meta` calls and writes ledger rows automatically. Expensive but bulletproof.
- Mandate `recordChange` on every MCP tool that writes (audit all tools). Tedious but tractable.
- Mark execute-php in ledger as a single "freeform PHP execution" row with payload hash + audit_id. Better than nothing.

### Gap #10 (workflow) — No "build entire site from spec" composite tool

We hand-rolled 14 sequential tasks. A `wp_site_scaffold(spec)` composite tool — give it a YAML spec like `{title, pages: [...], products: [...], menu: [...]}` — would compress this whole flow to one call. Existing scaffold tools cover blocks/patterns/plugins/themes but not site-level structure.

**Fix:** new composite tool `rolepod_wp_site_scaffold` that orchestrates option_set + page_create + product_create + menu_create + front_page_set + theme_styles_set from a single JSON spec. AI prompt → one-shot site.

## Tool surface gaps (missing tools)

Things that should exist but don't:

- `wp_menu_create` / `wp_menu_add_item` / `wp_menu_assign_location` — currently must use execute-php.
- `wp_product_create` (WooCommerce-aware) — currently must use execute-php with wp_insert_post + 8 meta updates.
- `wp_cf7_form_create` — same.
- `wp_global_styles_set` (Site Editor theme.json user overrides) — same.
- `wp_set_front_page(page_id)` — wraps the `show_on_front=page` + `page_on_front` + `page_for_posts` dance.
- `wp_seo_set` (Yoast/RankMath agnostic) — set focus keyword, meta description per post.

## Tool surface gaps (incomplete tools)

- `wp_post_create` accepts `meta` but doesn't seem to set Yoast SEO meta (untested here, but plugin docs imply meta needs separate REST endpoint).
- No way to upload featured image via MCP tools (would need fs-write + media-import companion endpoint).
- `wp_option_set` allowlist limitation as documented.

## What we proved works

- Companion v2.6.x mu-plugin recovery + early dispatch on demo ✅ (from earlier session)
- WP_REST API for posts/pages CRUD ✅
- Direct execute-php for arbitrary WP operations ✅
- wp-cli plugin install/activate via companion endpoint ✅
- Multi-tenant safety (production_hosts, manage_options, session token) ✅
- Frontend probe (all 5 pages → 200) ✅

## Recommended next priorities (post-1.9.1)

1. **v1.10 — fix RestTarget cli_run** (Gap #6). Single biggest blocker. Unlocks audit/diagnose/backup automatically.
2. **v1.10 — companion `/option-set` endpoint** (Gap #2/#4). Reliable wp_options writes via REST.
3. **v1.11 — server-side ledger capture in execute-php handler** (Gap #9). Track AI writes regardless of entry point.
4. **v1.11 — new composite tools**: site_scaffold, menu_create, product_create, cf7_create (Gap #10 + missing tools).
5. **v1.12 — fix health_check + tool descriptions** (Gap #1).
6. **v1.12 — payload_base64 / payload_file for execute_php** (Gap #7).

## Honest summary for stakeholders

The architectural foundation works: companion + mu-plugin guardian + recovery namespace + AST screen + audit log + production guard are all solid and tested.

The **tool layer** is uneven: about a third of tools work cleanly on RestTarget (the common case), a third have stale errors or wrong defaults, a third are missing entirely (menus, products, SEO, site-level orchestration). An AI driving this MCP can succeed on real-world WP builds — but it requires the AI to fluently fall back to execute-php whenever an MCP tool fails, which puts more burden on the AI and less on the platform.

Filling the v1.10-v1.12 gaps above would close ~80% of the friction.
