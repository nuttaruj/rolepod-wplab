# Changelog

All notable changes to `@rolepod/wplab` are documented here. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.11.5] — 2026-05-27 — Recovery tools no longer gate on companion handshake

Round 5 stress test exposed: all 7 `rolepod_wp_recovery_*` MCP tools were
routed through `bridgeFor(target)` which calls `handshake()`. When WP
WSODs (the exact scenario the recovery tools exist for), main companion's
`/wplab/v1/handshake` returns 500 → `bridgeFor` throws
`COMPANION_UNAVAILABLE` → user cannot recover via MCP.

The guardian's `/wplab-recovery/v1/*` endpoints authenticate via WP-native
Application Password (no session token), specifically so they survive
main-plugin death. Bridge methods for the recovery namespace don't need
the handshake at all.

### Fix — `bridgeForRecovery(target)` helper

New helper builds a `CompanionBridge` instance without calling
`handshake()`. All 7 recovery tools (`wp_recovery_status`,
`wp_recovery_disable_plugin`, `wp_recovery_disable_file`,
`wp_recovery_restore_file`, `wp_recovery_restore_snapshot`,
`wp_recovery_list_changes`, `wp_recovery_safe_mode`) switched from
`bridgeFor(target)` to `bridgeForRecovery(target)`.

### Verified live

Demo coffee-bloom theme functions.php fatal → main `/wplab/v1/handshake`
500 → guardian `/wplab-recovery/v1/status` 200 (via curl, proves
companion-side path). After v1.11.5 publish, MCP recovery tools will work
in the same scenario.

### No companion change

`/wplab-recovery/v1/*` endpoints already work without session token (App
Password auth). Pure MCP-side routing fix.

## [1.11.4] — 2026-05-27 — broken_images via /db-query + yoast/rankmath postMeta via /db-query

Continues Round 4 closeout (v1.11.3 already shipped ConfirmTrueSchema sweep).

### Fixed — `diagnose broken_images` scope routes via `/db-query`

Last diagnose scope still using `wp db query` directly. Routed via
`bridge.dbQuery` for RestTarget+companion (same pattern as
slow_queries/large_options in v1.11.0). Falls back to wp-cli for
shell-capable targets without companion. SQL contains embedded single
quotes (`'<img'`, `'src="'`, `'%<img%'`) that escapeshellarg mangled.

### Fixed — `yoast_read` + `rankmath_read` postMeta on RestTarget

Both adapter `postMeta` paths returned only `{ post_id }` on RestTarget
because:
- Yoast meta keys (`_yoast_wpseo_*`) aren't `register_meta(show_in_rest)`,
  so `/wp/v2/posts/<id>?_fields=meta` excludes them.
- Rank Math meta keys (`rank_math_*`) — same.

Fix: when `target.kind === "rest" && companion?.enabled`, read raw
postmeta via parameterised db-query:

```ts
bridge.dbQuery(
  "SELECT meta_key, meta_value FROM {prefix}postmeta WHERE post_id = %d AND meta_key IN (...)",
  [postId],
)
```

Verified live: pages with `_yoast_wpseo_focuskw` + `_yoast_wpseo_metadesc`
set via `wp_seo_set` (Round 2) now read back correctly through
`wp_yoast_read`.

### No companion change

Reuses `/db-query` shipped in companion v2.7.1. MIN_COMPANION_VERSION
unchanged.

## [1.11.3] — 2026-05-27 — Patch: ConfirmTrueSchema applied to all 17 `allow_destructive` fields

Round 4 cross-tool stress test surfaced 4 issues. All fixed.

### Fixed — ConfirmTrueSchema applied to all 17 `allow_destructive` fields

v1.10.0 introduced `ConfirmTrueSchema` (`true | "true"` union → boolean) for
`confirm` parameters on `execute_php` + `mail_test`. Round 4 caught that
**17 other schemas** still used raw `z.literal(true)` for
`allow_destructive`, so `scaffold_theme`, `scaffold_plugin`,
`scaffold_block`, `db_query` write paths, and all 11 page builder + SEO
adapter `_write` tools rejected `"true"` from MCP clients that
JSON-stringify booleans.

Fix: bulk-replace all `allow_destructive: z.literal(true)` →
`allow_destructive: ConfirmTrueSchema`. Moved `ConfirmTrueSchema`
declaration to top of schemas file (used by schemas earlier than its
previous position → TS2454).

### Fixed — `diagnose broken_images` now routes via `/db-query`

`brokenImagesProbe` was the only diagnose scope still using `wp db query`
directly. Stress test on RestTarget showed `"image scan deferred (db
query unsupported)"` because the SQL contained embedded single quotes
(`'<img'`, `'src="'`, `'%<img%'`) that escapeshellarg mangled. Same fix
as v1.11.0 slow_queries/large_options: route via `bridge.dbQuery()` for
RestTarget + companion.

### Fixed — `yoast_read` + `rankmath_read` postMeta on RestTarget

Both adapter `postMeta` paths returned only `{ post_id }` on RestTarget
because:
- Yoast meta keys (`_yoast_wpseo_*`) aren't `register_meta` show_in_rest,
  so `/wp/v2/posts/<id>?_fields=meta` excludes them.
- Rank Math meta keys (`rank_math_*`) — same.
- Previous fallback to `yoast_head_json` was incomplete.

Fix: when target.kind === "rest" && companion enabled, read raw postmeta
via `bridge.dbQuery("SELECT meta_key, meta_value FROM {prefix}postmeta
WHERE post_id = %d AND meta_key IN (...)", [postId])` — gets the real
values directly from DB. Falls back to existing wp-cli + REST shim for
non-companion targets.

Verified live: pages with `_yoast_wpseo_focuskw` + `_yoast_wpseo_metadesc`
set via `wp_seo_set` now read back correctly through `wp_yoast_read`.

### Pairs with companion v2.7.1 (unchanged)

No companion-side change required — these routes already use the
existing `/db-query` endpoint shipped in v2.7.1.

## [1.11.2] — 2026-05-27 — Patch: diagnose large_options autoload filter (WP 6.6+ values)

WP 6.6+ extended `wp_options.autoload` from `yes/no` to `yes/no/on/off/auto`.
Existing installs typically have `on` (autoloaded) + `off` (not) + `auto`
(new behavior). The hard-coded `WHERE autoload='yes'` in
`largeOptionsProbe` matched zero rows on Hostinger demo. Fix: filter
`autoload IN ('yes','on','auto')` to cover both legacy + current values.

Verified on demo: 269 `off` + 205 `on` + 94 `auto` + 1 `yes` rows. New
filter catches the actual autoload-enabled rows.

## [1.11.1] — 2026-05-27 — Patch: profile enum schema missing `strict` + `personal`

v1.11.0 added `profile.active` field to `connect_rest` response but the
zod enum was `["default", "power"]` — only matches MCP-tool wording, not
the actual `ProfileSchema` values from `profile/load.ts` which are
`["strict", "personal", "power"]`. `connect_rest` failed validation with
`"Expected 'default' | 'power', received 'strict'"` because new installs
default to `strict`.

Fix: align enum to the canonical `ProfileSchema` — `strict | personal | power`.
Description updated to explain what each tier unlocks.

No behavior change in tools. Pure schema fix.

## [1.11.0] — 2026-05-27 — Sub-gap closeout: backup tmp dir, db-query endpoint, power-profile UX

Closes 3 sub-gaps surfaced during v1.10.1 retest of E2E gaps. Pairs with
companion v2.7.1.

### Fixed — sub-gap A: `backup_create` `wp db export` exit 1

Root cause: `wp-content/uploads/wplab-tmp/` did not exist; mysqldump errno 2.
Fix in companion v2.7.1: `WpCli` endpoint now calls `wp_mkdir_p` for the
scratch dir before exec. Idempotent + cheap. `backup_create` now succeeds
on RestTarget with companion.

### Fixed — sub-gap B: `diagnose` slow_queries + large_options query failures

Two root causes:
1. `wp db query` over the wp-cli endpoint does NOT substitute `{prefix}`
   placeholders — the literal string went straight to mysql, got
   "Unknown table" error.
2. Shell quoting of SQL with single/double quotes is brittle.

Fix: companion v2.7.1 adds `POST /wp-json/wplab/v1/db-query` —
SELECT/SHOW/DESCRIBE/EXPLAIN/WITH only, `$wpdb->prepare` parameter binding,
auto-substitutes `{prefix}` → `$wpdb->prefix`. `diagnose` now routes
through `bridge.dbQuery()` for RestTarget+companion, with fallback to
`wp db query` for shell-capable targets without companion.

### Added — `Bridge.dbQuery(sql, params?)`

Thin wrapper around `/wplab/v1/db-query`. Reusable for any read-only DB
introspection tool. Refuses non-SELECT at companion side; binds params
via `$wpdb->prepare`.

### Fixed — sub-gap C: `wp_execute_php` POWER_PROFILE UX

`PowerProfileRequiredError` now returns a detailed message including:
- Exact env var name (`ROLEPOD_WPLAB_PROFILE`)
- Required value (`power`)
- Concrete `.mcp.json` snippet ready to paste
- Why the gate exists (execute-php = arbitrary PHP, opt-in by design)
- Confirmation that other MCP tools work without the gate

### Added — `connect_rest` exposes active profile

`rolepod_wp_connect_rest` response now includes:
```jsonc
"profile": {
  "active": "default" | "power",
  "execute_php_unlocked": boolean,
  "env_var_name": "ROLEPOD_WPLAB_PROFILE"
}
```

AI clients can read this at connect time to know whether `wp_execute_php`
is available without trial-and-error.

### Pairs with

`rolepod-wp` **v2.7.1** — `wplab-tmp` auto-mkdir + new `/db-query`
endpoint. MIN_COMPANION_VERSION unchanged at 2.1.0; new endpoints are
additive.

## [1.10.1] — 2026-05-27 — Patch: wave-3 PHP payload bugs surfaced in retest

3 bugs caught during v1.10.0 MCP retest:

- **site_scaffold**: `${JSON.stringify(input.x)}` embedded JSON object
  literal `{"a":1}` into PHP source → `ParseError: unexpected token "{"`.
  Fix: stringify-then-jsondecode pattern (build `json_decode("...", true)`).
- **seo_set**: same bug at line 51 `$input = ${JSON.stringify(input)};`.
  Fix: same stringify-then-jsondecode.
- **cf7_form_create**: default `mail_from` was `"[your-name] <noreply@${siteurl-domain}>"`
  — `${siteurl-domain}` was a documentation placeholder but PHP interprets
  `${siteurl}` as variable expansion → `Undefined constant "siteurl"`.
  Fix: default `mail_from` to `"[your-name] <[your-email]>"`.

No new features. No schema change. Tool count unchanged at 98. Build clean.
Smoke 3/3.

## [1.10.0] — 2026-05-27 — E2E gap closeout: companion /option-set, 9 new tools, ledger capture

Driven by the 2026-05-27 e2e build-out test on Hostinger demo where ~60% of
operations had to fall back to direct execute-php. 89 → 98 tools.

### Changed — option_set / option_get route via companion `/option-set` for RestTarget (Gap #2/#4)

Previously: `option_set` against RestTarget hit `/wp/v2/settings`, whose
allowlist uses different field names than raw wp_options (title vs blogname,
description vs blogdescription, timezone vs timezone_string). Writes
silently no-op'd. The tool returned `changed: true` but `option_get`
returned null on read-back.

Now: when companion is enabled, option_set/option_get route to the new
companion endpoints which call `update_option()` / `get_option()` directly.
Full wp_options coverage. Blocked keys (db_version, auth_key, secret,
rewrite_rules, etc.) refuse with `OPTION_BLOCKED`. Falls back to REST
settings only if companion is unavailable.

### Changed — `wp_backup_create` accepts RestTarget with companion (Gap #8)

Was hard-gated to LocalTarget/SshTarget/DockerTarget. Now also accepts
RestTarget when `companion.enabled` is true (wp-cli routes through
companion's wp-cli endpoint, so all backup ops work). The error message is
clearer when companion is missing.

`audit_security` + `audit_many` + `diagnose` were already kind-agnostic in
v1.9 — the stale errors reported in the e2e test came from npm v1.2.3 which
hadn't been updated since the local source diverged. Re-publish to npm
unblocks them.

### Changed — `health_check` uses companion-aware probes (Gap #1)

Removed the "v0.2+ required" stale warnings. wp_cli_ok / db_ok now reflect
actual reachability via target.wpCli() which works on RestTarget through
companion. Added rest_ok probe using `target.rest({ path: '/wp/v2/types/post' })`.

### Changed — `execute_php` `confirm` schema accepts true OR "true" (Gap #3)

`z.literal(true)` rejected the string "true" some MCP clients send when
JSON-stringifying booleans. New `ConfirmTrueSchema` union accepts both forms
and normalizes to boolean true semantically. Same fix applied to
`mail_test.confirm`.

### Added — `Bridge.optionSet(name, value, autoload?)` + `Bridge.optionGet(name, default?)`

Thin wrappers around companion endpoints `/wp-json/wplab/v1/option-set` +
`/option-get`. Reused by `wp_option_set` / `wp_option_get` for RestTarget
and available for any new tool that needs direct wp_options access.

### Added — 9 new MCP tools (89 → 98)

- **`rolepod_wp_menu_create`** — create (or reuse) a nav menu by name.
- **`rolepod_wp_menu_add_item`** — add page link or custom URL item to menu.
- **`rolepod_wp_menu_assign`** — assign menu to theme location (primary / footer).
- **`rolepod_wp_product_create`** — WooCommerce simple product (price + sku + stock + categories). Refuses if WC not active.
- **`rolepod_wp_set_front_page`** — static front page + blog index in one call (show_on_front + page_on_front + page_for_posts).
- **`rolepod_wp_global_styles_set`** — write user-level wp_global_styles for the active block theme (Site Editor equivalent).
- **`rolepod_wp_cf7_form_create`** — Contact Form 7 form + mail config + recipient. Returns ready-to-paste shortcode.
- **`rolepod_wp_seo_set`** — set Yoast OR Rank Math post meta (auto-detect). Focus keyword + meta description + canonical + noindex.
- **`rolepod_wp_site_scaffold`** (composite) — one-shot site build from a JSON spec: identity + pages + menu + front_page assignment. Returns slug → id manifest.

All 9 tools auto-ledger their writes. `wp_site_scaffold` runs server-side
in one execute-php call so the entire scaffold is roughly atomic.

### Pairs with

`rolepod-wp` **v2.7.0** — adds companion endpoints `/option-set`,
`/option-get`, and server-side ledger capture in `/execute-php` (regex
scans payload for update_option / wp_insert_post / wp_update_post /
update_post_meta / activate_plugins / etc. and records one ledger row per
detected write, tagged source_tool=execute_php). Closes Gap #9 — writes
issued via execute-php (the main escape hatch) are now discoverable in
the AI Change Ledger.

### Smoke test

98 tools alphabetized in `tests/smoke/mcp-handshake.test.ts`. tsc clean.
Bundle size 2.34 MB (+~6 KB for 9 small tool files).

## [1.9.1] — 2026-05-27 — Branding cleanup (remove third-party references)

Doc-only patch. Removed all references to the third-party WordPress AI plugin
that originally inspired the project's design exploration. Independent
implementation language used throughout README, CONTRIBUTING, package.json,
CHANGELOG entries, and the `wp_conventions` tool description. The deleted
`docs/MIGRATION-FROM-THIRD-PARTY.md` removed entirely (single-purpose migration
guide).

No behavior change. No new tools. No schema change. Tool count unchanged
at 89.

## [1.9.0] — 2026-05-27 — Recovery namespace (mu-plugin guardian wrappers)

Seven new MCP tools for crash recovery via the new `/wplab-recovery/v1/*`
namespace that ships in companion v2.6.0's mu-plugin guardian. The guardian
loads before regular plugins so its REST endpoints survive main-plugin
parse errors / fatals. 82 → 89 tools.

### Added — recovery tools

- **`rolepod_wp_recovery_status`** — probe guardian. Returns
  `main_alive`, `recent_fatals[]`, `last_fatal`, `safe_mode`,
  `guardian_version`. Use after a 5xx from main namespace to determine
  whether you're in recovery mode.
- **`rolepod_wp_recovery_disable_plugin`** — rename plugin main file to
  `.disabled`. Accepts slug or `slug/file.php` form. Calls
  `deactivate_plugins()` for active_plugins cleanup. Use when a plugin
  (often the one just updated/edited) is fataling.
- **`rolepod_wp_recovery_disable_file`** — scope-checked rename
  `<path>` → `<path>.disabled` for any file under
  `wp-content/{plugins,themes,uploads,mu-plugins}` or `wp-config.php`.
  Use when a specific file (theme `functions.php`, plugin include) is
  the culprit but you don't want to nuke the whole plugin.
- **`rolepod_wp_recovery_restore_file`** — reverse. Accepts either
  the `.disabled` form or active form.
- **`rolepod_wp_recovery_restore_snapshot`** — untar a previously
  captured theme snapshot via the guardian (bypasses main companion's
  `/theme/restore` which would be unreachable if main is down).
- **`rolepod_wp_recovery_list_changes`** — direct DB read of the
  ledger. Useful pre-rollback to identify the suspect write.
- **`rolepod_wp_recovery_safe_mode`** — toggle `rolepod_wp_safe_mode`
  option. When ON, the main companion (when alive) should refuse risky
  ops to prevent the AI from immediately re-introducing the bad write.

### Added — `RecoveryModeError` (`src/util/errors.ts`)

Surfaces when main namespace 5xx + guardian reports `main_alive: false`.
Includes `last_fatal` (file/line/message) so the AI can decide which file
to disable without an extra status probe.

### Added — `Bridge` recovery methods

`CompanionBridge.recoveryStatus / recoveryDisablePlugin /
recoveryDisableFile / recoveryRestoreFile / recoveryRestoreSnapshot /
recoveryListChanges / recoverySafeMode` — all hit
`/wplab-recovery/v1/*` and use Application Password auth via
`target.rest()` (no session token; main `/handshake` may be down).

### Pairs with

`rolepod-wp` **v2.6.2+** (recommended) — companion with the mu-plugin
guardian auto-installed on plugin activate. Version notes:

- **v2.6.0** — initial guardian. REST endpoints registered via
  `rest_api_init` only, which is unreachable during theme-load fatal
  (~40% of WSODs). Useful for post-`init` fatals only.
- **v2.6.1** — added `muplugins_loaded:PHP_INT_MAX` early-dispatch path
  so recovery endpoints reachable during ANY post-mu-plugin fatal
  (theme load, plugin file parse). Recovery coverage ~95%.
- **v2.6.2** — best-practices auth hardening. Pluggable.php load order
  fix + REDIRECT_HTTP_AUTHORIZATION + getallheaders() fallbacks for
  broader server compat (Apache mod_php, Apache FastCGI, Nginx FPM,
  LiteSpeed). Set as the floor in `MIN_COMPANION_VERSION`.

### Demo test learning (recorded for future contributors)

The architecture pattern "mu-plugin recovery via `rest_api_init`" has a
trap: REST routes don't register until WP boot completes through `init`,
which is gated by `setup_theme` → theme `functions.php` load. A fatal in
the theme file kills the boot before `rest_api_init` fires. The guardian
mu-plugin DID load (mu-plugins are pulled in before plugins/themes in
`wp-settings.php`), and its `register_shutdown_function` DID record the
fatal — but the REST endpoints weren't registered, so the AI couldn't
query / disable / recover.

The fix (companion v2.6.1) detects recovery URLs at the top of mu-plugin
load and short-circuits at `muplugins_loaded:PHP_INT_MAX`, bypassing
plugin + theme load entirely. Manual Application Password auth via
`WP_Application_Passwords::validate_application_password()` works because
WP loads its core classes (incl. that one) before mu-plugins via
`wp-load.php`.

Result: if v2.6.1+ is installed BEFORE a WSOD-inducing write, recovery
works through REST. If only v2.6.0 was installed and a theme-level fatal
hits, manual SSH/FTP/cPanel recovery is still required (chicken-and-egg
on the upgrade path — to install v2.6.1, WP must boot, but WP can't
boot through the fatal).

### Smoke test

`tests/smoke/mcp-handshake.test.ts` expected tool list updated 82 → 89.
TypeScript compile clean (`tsc --noEmit`). Bundle size: 2.33 MB (unchanged
material, +~3 KB from 7 small tool files).

## [1.8.0] — 2026-05-27 — Capability closeout: one-time admin login + file toggle + 3 field-plugin adapters + conventions

Eleven new MCP tools driven by the v2.4 competitive analysis pass. 71 → 82 tools.

### Added — admin + file ops

- **`rolepod_wp_admin_one_time_link`** — mint a 5-min single-use wp-admin
  login URL (companion `/admin/one-time-login`). Browser-automation safe;
  no admin password exposed.
- **`rolepod_wp_file_disable`** — rename `<path>` → `<path>.disabled`
  (companion `/fs-rename`). PHP files become invisible to autoloader.
  Auto-ledger row category=file action=disable, reversible.
- **`rolepod_wp_file_enable`** — reverse `wp_file_disable`. Refuses if
  destination already exists.

### Added — field-plugin adapters

- **`rolepod_wp_jetengine_{read,write}`** — JetEngine field groups + CCT
  list + post meta. Detection via REST plugin search.
- **`rolepod_wp_metabox_{read,write}`** — Meta Box (metabox.io) field
  groups (rwmb_meta_box post type) + post meta.
- **`rolepod_wp_pods_{read,write}`** — Pods Framework pods (_pods_pod) +
  fields (_pods_field) + post meta. Compatible free + Pro.

All field-plugin writes auto-ledger (category=post) with before-state
captured via REST GET ?context=edit.

### Added — project conventions storage

- **`rolepod_wp_conventions_{get,set}`** — per-site structured style guide
  storage at `~/.config/rolepod-wplab/memory/<host>/conventions.json`.
  Schema: colors[], fonts[], spacing[], style_rules[], code_conventions[],
  brand_voice, custom{}. `set` defaults to merge (deep); pass
  `merge: false` to replace.

### Changed — Gutenberg block-count in post_create output

`wp_post_create` now scans content for `<!-- wp:` block markers and reports
`block_count` in the ledger after-state. Informational only; behavior
unchanged. Helps the AI confirm Gutenberg vs classic content was authored
correctly.

### Bridge additions

- `Bridge.adminOneTimeLink(destination?)` — POST `/admin/one-time-login`.
- `Bridge.fsRename(src, dest)` — POST `/fs-rename`, scope-checked.

### Tool count

71 (v1.7) → **82** (v1.8). Adds: admin_one_time_link, file_disable,
file_enable, conventions_get, conventions_set, jetengine_read,
jetengine_write, metabox_read, metabox_write, pods_read, pods_write.

### Deferred — WordPress Abilities API wrapper

Considered + deferred. WP Abilities API (WP 6.9+) has minimal cross-ecosystem
adoption today. Re-evaluate when:
- WordPress 7.0 ships with Abilities in core.
- Multiple well-known plugins adopt the API publicly.
- Users explicitly ask for cross-consumer ability discovery.

Standard MCP works with every MCP client today; WP-side ability registration
adds composer dep + PHP layer for marginal benefit at present.

### Pairs with

- `rolepod-wp` v2.5.0 — adds `/admin/one-time-login`, `/fs-rename` endpoints
  + execute-php crash recovery.

## [1.7.0] — 2026-05-27 — Theme safety: pre-write validators + snapshot + child-theme-first + safe-switch

### Added — pre-write validators on `wp_file_write`

- `.php` files: companion runs `php -l` server-side. Reject on syntax error
  with line + message — WSOD on functions.php is now impossible via this MCP.
- `.json` files: Node-side `JSON.parse` before sending. Catch typos before
  they hit the wire.
- Both validators are unbypassable (no opt-out flag). Companion infra failures
  (exec disabled, transient host issue) degrade to "best-effort skip", not
  block the user.

### Added — theme snapshot + restore + safe switch

- `rolepod_wp_theme_snapshot` — capture full theme dir as `.tar.gz` under
  `wp-content/uploads/rolepod-wp-theme-snapshots/<slug>-<utc-ts>.tar.gz`.
- `rolepod_wp_theme_restore` — un-tar a snapshot back over the theme dir.
  Refuses out-of-managed-dir paths (path validation in companion).
- `rolepod_wp_theme_switch_safe` — composite: snapshot CURRENT theme →
  `wp-cli theme activate <new>` → REST `GET /` post-switch health probe →
  AUTO-ROLLBACK (re-activate old + restore snapshot) on red. Ledger row
  category=theme so manual revert via `wp-changes` also works.

### Added — child-theme-first composite

- `rolepod_wp_child_theme_create` — reads parent style.css for Theme Name +
  Version, scaffolds child dir (style.css with `Template: <parent>` header,
  functions.php with parent-style enqueue). Refuses if child slug already
  exists. Standard WP best practice baked in.

### Added — session correlation

- `rolepod_wp_session_start` — issues `sess_<hex>` id, sets
  `ROLEPOD_WPLAB_SESSION` env so all subsequent auto-ledger writes group
  under one source_session. Atomic revert via
  `rolepod_wp_changes_toggle_bulk { source_session: <id> }`.

### Added — auto cache flush + global-styles ledger

- `wp_file_write` paths ending `theme.json` → auto `wp cache flush` after
  write so the Site Editor sees the new state on next reload.
- `wp_rest_request POST /wp/v2/global-styles/<id>` → captures before-state
  via a GET first, records `category=layout subcategory=global_styles` in
  the Change Ledger, then auto-flushes object cache.

### Skill restructure (13th skill)

- New `wp-edit-theme` skill (phase=build) owns theme files + theme.json +
  global-styles + child themes + safe theme switch.
- `wp-edit-design` scope narrows to page-builder layouts only (Elementor /
  Divi / Oxygen / Bricks) — clearer mental model.
- `wp-full` alias updated to list both.

### Tool count

62 (v1.5) → 66 (v1.6, ledger) → **71** (v1.7, adds: theme_snapshot,
theme_restore, child_theme_create, theme_switch_safe, session_start).

### Pairs with

- `rolepod-wp` v2.4.0 — adds `/wplab/v1/syntax-check`, `/theme/snapshot`,
  `/theme/restore` endpoints.

## [1.6.0] — 2026-05-26 — AI Change Ledger + per-change toggle + panic-revert

### Added — `Bridge.changes` methods + 4 MCP tools

`Bridge` gains `recordChange`, `queryChanges`, `toggleChange`, `toggleChangesBulk`, `panicChanges` — all targeting the new `/wplab/v1/changes/*` endpoints in companion v2.3+. Four MCP tools expose this surface:

- `rolepod_wp_changes_query` — filter the ledger (category / applied / since_minutes / source_session).
- `rolepod_wp_changes_toggle` — flip one row's applied flag, run companion's per-category revert.
- `rolepod_wp_changes_toggle_bulk` — batch flip (used for git-bisect-style narrowing).
- `rolepod_wp_changes_panic` — disable every change in a time window (1-1440 min).

Total MCP tools surface: 62 → 66.

### Added — auto-ledger wiring on writer tools

`wp_post_create`, `wp_post_update`, `wp_option_set`, `wp_file_write` now capture before+after state via the new `recordChange()` helper at `src/companion/ledger.ts`. Failure is non-fatal (companion missing / endpoint disabled / older companion = skip and continue).

Env override `ROLEPOD_WPLAB_LEDGER=off` disables recording entirely (for tests or privacy-restricted deployments). Default = on.

Future tools to wire (v1.7): adapter writes (`wp_elementor_write`, `wp_divi_write`, etc.), `wp_scaffold_*`, `wp_clone`, `wp_migrate_data`. Tools that genuinely cannot be reverted (`wp_execute_php` side effects, destructive wp-cli) record with `reversible: false` so the user sees the warning icon in the admin UI.

### Added — `wp-changes` skill (12th skill)

Phase = recovery. Owns the rollback workflow:
- query the ledger,
- toggle individual rows,
- panic-disable a window when the site breaks,
- bisect to identify the bad change after recovery.

Updated `wp-full` alias to list it.

### Bumped

- `MIN_COMPANION_VERSION` stays at `2.1.0` — `2.3.0` is BACKWARD-COMPATIBLE for older MCP builds (ledger endpoints are additive). MCP v1.6 with companion v2.1 → ledger calls return 404 + writer tools skip recording with a debug log; everything else works.

### Pairs with

- `rolepod-wp` v2.3.0 — ships the ledger table, recorder API, per-category toggle dispatchers, hook wrapper helper, and the admin UI at Tools → Rolepod WP Changes.

## [1.5.0] — 2026-05-26 — Lean 11-skill rewrite per Rolepod parent contract

### Changed — full skill-set restructure

The 11 skills are rewritten end-to-end per the [Rolepod parent skill-authoring contract](https://github.com/nuttaruj/rolepod/tree/main/core/skills). Each `SKILL.md` now follows the mandatory shape (frontmatter with `tier` + `phase`, `Iron Rule`, `When to use` + `Skip when`, `Boundary` with Owns / Does not own / Hand off, `Workflow`, `Output`, `Examples` pointer, `References` pointer, `Hard stops`, `Full Rolepod enhancement`, `Next phase`). Each skill ≤ 144 lines.

Supporting files (16 total — under the 36-file cap):
- `wp-pair-setup/examples/pair-examples.md`
- `wp-connect/references/connect-kinds.md`
- `wp-health-check/templates/health-report.md`
- `wp-content/examples/content-examples.md`
- `wp-edit-design/references/builder-formats.md` + `examples/design-examples.md`
- `wp-edit-plugin/references/adapter-detection.md`
- `wp-scaffold/templates/scaffold-manifest.md` + `examples/scaffold-examples.md`
- `wp-introspect/references/introspect-scopes.md`
- `wp-diagnose/templates/diagnose-report.md` + `examples/diagnose-examples.md`
- `wp-migrate/templates/migrate-plan.md` + `examples/migrate-examples.md`
- `wp-execute-php/references/ast-rules.md` + `examples/php-examples.md`
- `wp-full/` (alias, zero supporting files)

### Skill set, by phase

| Phase | Skill |
|---|---|
| define | wp-pair-setup, wp-connect |
| verify | wp-health-check |
| build | wp-content, wp-edit-design, wp-edit-plugin, wp-scaffold |
| debug | wp-introspect, wp-diagnose |
| ship | wp-migrate |
| power | wp-execute-php |
| alias | wp-full |

### Coverage

The new 11 cover all 62 MCP tools with zero overlap:
- **wp-pair-setup** owns the single-use pair_token redemption flow.
- **wp-connect** owns target-kind selection (local / rest / ssh / docker) post-pair.
- **wp-health-check** owns the sub-5s readiness ping.
- **wp-content** owns core REST CRUD (posts, pages, users, options, db SELECT).
- **wp-edit-design** owns visual layouts (Elementor + Divi + Oxygen + Bricks + theme.json + global-styles).
- **wp-edit-plugin** owns SEO / i18n / e-commerce / custom-fields / forms (Yoast, RankMath, WPML, WooCommerce, ACF, Gravity / CF7 / WPForms).
- **wp-scaffold** owns bootstrap of new block / plugin / theme / pattern.
- **wp-introspect** owns read-only runtime snapshots.
- **wp-diagnose** owns multi-probe sweep + audit + audit_many.
- **wp-migrate** owns dryrun + apply + backup + restore + clone across targets.
- **wp-execute-php** owns last-resort PHP eval with the five-layer safety chain.
- **wp-full** is a zero-supporting-file alias listing every skill.

### Removed (subsumed)

- `wp-audit-security` → folded into `wp-diagnose`.
- `wp-audit-woo` → folded into `wp-diagnose` + `wp-edit-plugin` (read scope).
- `wp-edit-elementor` → generalized to `wp-edit-design` (all 4 builders).
- `wp-scaffold-block` + `wp-scaffold-plugin` + `wp-scaffold-theme` → unified to `wp-scaffold`.
- `wp-migrate-dryrun` → expanded to full `wp-migrate` (dryrun + apply + rollback).

## [1.4.0] — 2026-05-26 — RestTarget full shell capability via companion

### Added — `RestTarget` now shell-capable via the `rolepod-wp` v2.1+ companion

- `Bridge.wpCli(args, opts)` — POSTs `/wplab/v1/wp-cli` with session_token, parses
  the JSON response into the standard `WpCliResult` shape. Auto-refreshes the
  session token on 401, auto-bootstraps `wp-cli.phar` from upstream on first
  `WP_CLI_NOT_BUNDLED` (via the new `/wp-cli/bootstrap` companion endpoint), then
  retries the original call once.
- `Bridge.fileRead(path)` — POSTs `/wplab/v1/fs-read`; scope guard runs server-side.
- `Bridge.fileWrite(path, content, opts)` — POSTs `/wplab/v1/fs-write`; supports
  mode/backup/confirmUnsafePath opts, mirrors the LocalTarget signature.
- `RestTarget` now lazy-caches a single `CompanionBridge` instance per target,
  reusing one handshake/session across all companion-gated calls.
- `RestTarget.wpCli` delegates to `Bridge.wpCli` (was: hard error `COMPANION_REQUIRED_V0_2`).
- `RestTarget.fileRead` / `.fileWrite` / `.fileExists` likewise delegate.

### Changed — composite tools drop their `kind!==local|ssh|docker` gates

`wp_diagnose`, `wp_cron_tool`, `wp_cache_tool`, `wp_mail_test`, `wp_user_session_list`
all used to throw `*_REQUIRES_SHELL` upfront. They now call `target.wpCli` directly;
on a RestTarget without companion, `CompanionUnavailableError` with the stable
install URL surfaces from `Bridge.handshake` (better message than the old gate
because it tells the user how to fix it).

`audit_security` already used `target.wpCli` without a kind gate — it now works
over RestTarget transparently.

### Bumped

- `MIN_COMPANION_VERSION` = `2.1.0` (companion v2.0.0 had the wp_cache_* session
  token bug; v2.1 uses transients so the handshake-then-act flow actually works
  on shared hosting). MCP warns post-pair if the detected companion is older.

### Pairs with

- `rolepod-wp` v2.1.0 — adds `/wp-cli/bootstrap` + SessionToken transient backend.

## [1.3.0] — 2026-05-26 — Cross-component contract + rolepod-wp companion rename

### Added

- `src/companion/constants.ts` — single source of truth for the cross-repo contract:
  - `COMPANION_INSTALL_URL` — stable `releases/latest/download/rolepod-wp.zip` URL
  - `COMPANION_PLUGIN_SLUG = "rolepod-wp"`
  - `COMPANION_REPO_URL = https://github.com/nuttaruj/rolepod-wp`
  - `MIN_COMPANION_VERSION = "2.0.0"` — version-compat floor; warns post-pair if companion is older
  - `compareVersions()` + `isCompanionTooOld()` helpers
  - `setupWizardUrlFor(siteurl)` builder targeting `?page=rolepod-wp-setup`
- 5 unit tests for the new constants module (147 → 152 total tests, all green).

### Changed

- `wp_connect_rest` `CREDENTIALS_MISSING` + `COMPANION_REQUIRED_BUT_MISSING` errors now embed the stable install URL + a `wp plugin install <URL> --activate` one-liner so AI agents can hand users a copy-paste command.
- `wp_pair` post-pair warns when companion_version < MIN_COMPANION_VERSION (non-blocking).
- `CompanionUnavailableError` accepts `installUrl` hint; surfaces in error message + meta.
- `Bridge.ts` handshake 404 + introspect 404 now pass the install URL hint.
- `runtime/RestTarget.ts` REST_AUTH_FAILED guidance uses `setupWizardUrlFor()` + "Rolepod WP Setup" wording.
- `bin/companion.ts` install command emits from constant.
- `bin/init.ts` no-companion message references the new "rolepod-wp" name.
- README Path A install URL switched to the new stable `rolepod-wp.zip` URL.
- README + CONTRIBUTING + SECURITY rephrased to call the WP plugin `rolepod-wp` (the WordPress arm of the [Rolepod ecosystem](https://github.com/nuttaruj/rolepod)) rather than "companion".
- 4 marketplace manifest descriptions rephrased to match the new positioning.
- CONTRIBUTING gains a release-protocol section: version-pair convention across the two repos, MIN_COMPANION_VERSION bump rule, "never ship MCP before companion zip is live" ordering.

### Pairs with

- `rolepod-wp` v2.0.0 (the renamed companion plugin). Existing v1.x companion installs continue to handshake on `/wplab/v1/*` for wire compatibility, but install URL guidance now points at the new repo.

## [1.2.4] — 2026-05-26 — Schema-verified plugin marketplaces (Claude Code + Codex)

### Added

- **`.claude-plugin/marketplace.json`** — enables `claude plugin marketplace add nuttaruj/rolepod-wplab` + `claude plugin install rolepod-wplab@rolepod-wplab`. Schema-verified against https://code.claude.com/docs/en/plugin-marketplaces.
- **`.codex-plugin/plugin.json`** — Codex CLI plugin manifest with full `interface` block (displayName, shortDescription, longDescription, capabilities, defaultPrompt). Schema-verified against https://developers.openai.com/codex/plugins/build.
- **`.agents/plugins/marketplace.json`** — Codex local marketplace catalog with `source.path: "./"` (plugin lives at repo root, not in a subdir). Schema-verified against same source.

### Changed

- README **Codex CLI** section gets the marketplace install path (in addition to the manual `config.toml` snippet).
- README **Gemini CLI** section now notes skills are not auto-registered (no stable extension format yet — matches the rolepod-uiproof honesty).
- `package.json` `files[]` adds `.codex-plugin` + `.agents` so the marketplace catalogs ship with the npm package.

### Schema-bound source URLs (locked in for SCHEMA-BOUND-file hook policy)

| File | Source |
|---|---|
| `.claude-plugin/marketplace.json` | https://code.claude.com/docs/en/plugin-marketplaces |
| `.claude-plugin/plugin.json` | https://code.claude.com/docs/en/plugins-reference |
| `.codex-plugin/plugin.json` | https://developers.openai.com/codex/plugins/build |
| `.agents/plugins/marketplace.json` | https://developers.openai.com/codex/plugins/build |

### Numbers

- MCP tools: 62 (unchanged).
- Tests: 141 passing.

## [1.2.3] — 2026-05-26 — Install path fixes + README rewrite

### Fixed

- `.mcp.json` previously pointed at `${CLAUDE_PLUGIN_ROOT}/dist/bin/rolepod-wplab.js`. `dist/` is gitignored, so users who installed via `claude plugin install nuttaruj/rolepod-wplab` got a server that wouldn't spawn. Now uses `npx -y @rolepod/wplab@latest serve` — pulls from npm, always works.
- `.claude-plugin/plugin.json` version was stuck at `0.1.0`. Now `1.2.2` (will sync to package.json version on each release).
- `package.json` `files` referenced `.cursor-plugin` + `.codex-plugin` directories that never existed. Replaced with the real `.mcp.json` + `.cursor/mcp.json` configs.

### Added

- `.cursor/mcp.json` — drop-in workspace MCP config for Cursor IDE (per-project or global via `~/.cursor/mcp.json`).
- New README written in [`rolepod-uiproof`](https://github.com/nuttaruj/rolepod-uiproof) style — concise headline, "What it helps with" action list, skills table, per-CLI install (Claude Code / Cursor / Codex / Gemini / Direct npm), Path A (pair) + Path B (manual) quick start, doctor output, "What's inside" tech summary.

### Numbers

- MCP tools: 62 (unchanged).
- Tests: 141 passing.

## [1.2.2] — 2026-05-26 — Slim dist

### Changed

- `tsup.config.ts` — `sourcemap: false` for shipped builds. dist size **14.6 MB → 4.8 MB (-67%)** by dropping the two `.map` files (~10 MB total) that were ~68% of the bundle. End users `npx` the binary and rarely inspect stack traces; local devs can re-enable maps with `npx tsup --sourcemap` when debugging.
- No source change. No schema change. No tool change.

### Numbers

- npm tarball: **~2.7 MB → ~750 KB packed** (typical sourcemap-heavy → slim ratio).
- MCP tools: 62 (unchanged).
- Tests: 141 passing.

## [1.2.1] — 2026-05-26 — Path-2 polish

### Changed

- `rolepod_wp_connect_rest` `CREDENTIALS_MISSING` error now lists BOTH paths (companion Quick Start URL + manual `credentials add` command) so the AI can guide the user without guessing.
- `RestTarget.open` `REST_AUTH_FAILED` error includes the same two-path suggestion plus the setup-wizard URL on the target host.
- Both errors carry `setup_wizard_url` in `meta` for AI agents that prefer structured data over message text.

### Numbers

- MCP tools: **62** (unchanged).
- Tests: 141 passing.

## [1.2.0] — 2026-05-26 — One-click pair (token-redeem setup UX)

### Added

- `rolepod_wp_pair { siteurl, pair_token }` — single MCP call that redeems a companion-issued pair token for a real WP Application Password (companion-minted under the issuing admin's user, named `wplab-pair-<timestamp>`). Stores credential in vault + opens a `RestTarget` in one shot.
- Companion endpoint **POST `/wp-json/wplab/v1/pair/generate`** (admin only, manage_options) — issues a 256-bit pair token, TTL 60 min, max 5 active per admin.
- Companion endpoint **POST `/wp-json/wplab/v1/pair/redeem`** (public, token-authed) — atomic single-use redeem; per-IP throttle (10 failed / hour).
- Companion `src/Security/PairToken.php` — SHA-256 hashed-at-rest tokens in `wp_options`, opportunistic sweep of expired rows.
- Companion `Tools → WPLab Setup` page extended with **"⚡ Quick Start"** section: button → mints pair token → renders ready-to-paste prompt that includes Claude Code / Cursor / Codex / Gemini install snippets + `rolepod_wp_pair` call with siteurl + pair_token baked in. One-click copy.
- New skill `skills/wp-pair-setup/SKILL.md` — instructs AI agents on the pair flow + failure modes + security notes.

### Schema additions

- `PairInputSchema` — siteurl https-only refine + pair_token regex `/^wplab_pair_[a-f0-9]{48}$/`.
- `PairOutputSchema` — target_id + siteurl + username + capabilities + companion_version + is_production + app_password_name + credential_stored.

### Security

- Pair token = SHA-256 hashed at rest, never returned by any GET endpoint.
- Single-use guarantee: `PairToken::redeem` deletes the wp_options row **before** acting on the payload — concurrent redeem attempts can't both succeed.
- TTL 60 min, post-redeem the App Password is the long-lived credential (revocable from `profile.php`).
- Pair generate requires admin (`manage_options`). Pair redeem rate-limited per IP via transient.
- App Password name `wplab-pair-<UTC-timestamp>` makes attribution + revocation trivial.
- Production guard unchanged — pair-minted credentials are subject to all the same `ProdGuard` checks on power tools.
- Companion `endpoints_enabled` master toggle still applies — pair endpoints respect it.

### Numbers

- **MCP tools**: 61 → 62 (+1: `rolepod_wp_pair`).
- **Companion REST endpoints**: 8 → 10 (+2: pair/generate, pair/redeem).
- **Skills**: 10 → 11 (+1: wp-pair-setup).
- **Unit + smoke tests**: 134 → 141 (+7 PairInput/Output schema tests).

### Notes

- Schema-freeze policy honored: every change is additive (new tool, new schemas, new endpoints).
- Companion-first install path is now the recommended quick-start. Manual setup path (App Password + npm install + claude mcp add + credentials add) preserved on the same wizard page for users on CLIs without a wplab plugin.

## [1.1.0] — 2026-05-26 — Parity + lead expansion (Tier A/B/C/D)

### Added — Tier A (parity with existing WP AI tools)

- `rolepod_wp_divi_read` / `rolepod_wp_divi_write` — Divi Builder pages (post_content shortcodes + `_et_pb_use_builder` flag).
- `rolepod_wp_oxygen_read` / `rolepod_wp_oxygen_write` — Oxygen Builder (`ct_builder_shortcodes` post meta).
- `rolepod_wp_bricks_write` — extends Bricks adapter with page / header / footer element-tree writes.
- `rolepod_wp_yoast_write` — Yoast SEO post meta (focus_keyword / meta_description / title / canonical / noindex).
- `rolepod_wp_rankmath_write` — Rank Math SEO post meta (mirrors Yoast surface).
- `rolepod_wp_wpml_write` — set_post_language / link_translations / duplicate_for_translation ops.

### Added — Tier B (capability extensions)

- `rolepod_wp_forms_read` / `rolepod_wp_forms_write` — unified Gravity / Contact Form 7 / WPForms adapter with auto-detect.
- `rolepod_wp_cron_tool` — list / run / delete WP-Cron events.
- `rolepod_wp_cache_tool` — inspect object cache + transient counts; flush_object / flush_transients ops.
- `rolepod_wp_mail_test` — send test email via wp_mail() (companion execute-php preferred, wp-cli `wp eval` fallback).
- `rolepod_wp_clone` — composite: db export+import + wp-content sync + url search-replace + plugin version sync.
- `rolepod_wp_backup_create` / `rolepod_wp_backup_restore` — db dump + wp-content manifest snapshots.

### Added — Tier C (setup UX parity)

- `rolepod-wplab init` — interactive 5-step wizard (App Password + REST probe + handshake + credential store + starter profile).
- `rolepod-wplab companion install --target=<host>` — probe + emit copy-paste wp-cli installer command.
- `rolepod-wplab companion status --target=<host>` — handshake check + capability dump.
- Companion plugin: new **Tools → WPLab Setup** wizard page with App Password + MCP install copy-paste blocks.

### Added — Tier D (moat extend)

- `rolepod_wp_user_session_list` — enumerate active user sessions via `wp_usermeta.session_tokens` (security audit).
- `rolepod_wp_rest_dump` — enumerate every registered REST route (optional `filter_namespace`).
- `rolepod_wp_scaffold_pattern` — scaffolds a block pattern PHP file inside a theme or plugin.
- `rolepod_wp_diagnose` — non-destructive sweep: plugin_conflict_probe / slow_queries / large_options / broken_images / php_errors.

### Changed

- `AllowList.ts` — added wp-cli READ_ONLY entries: `transient list`, `cache type`, `user session list`.
- `AllowList.ts` — added wp-cli DESTRUCTIVE entries: `cron event run` / `delete` / `schedule`, `cache flush`, `transient delete` / `delete-expired`, `db export` / `import`, `search-replace`, `wpml`, `gf`, `user session destroy`.
- `tests/smoke/mcp-handshake.test.ts` — expected tool count 41 → 61.

### Numbers

- **MCP tools**: 41 → 61 (+20).
- **Adapters**: 8 (Elementor / Woo / ACF / Bricks / WPML / Yoast / RankMath) + 3 new dir (Divi / Oxygen / Forms).
- **CLI subcommands**: 5 → 7 (added `init`, `companion`).
- **Companion REST endpoints**: 8 (unchanged).
- **Unit + smoke tests**: 117 passing.

### Notes

- Schema-freeze policy honored: every new tool is **additive** (new tool names). No existing input/output schema fields changed.
- Forms adapter `list_entries` is wired for Gravity Forms in v1.1; CF7 / WPForms entries land in plugin-private tables — adapter returns empty for those scopes in v1.1 (planned for v1.2 once both expose entry REST routes consistently).
- `wp_clone` `wp_content` scope copies top-level entries only — full deep tree sync (large media) is deferred to v1.2 with a companion `fs-rsync` endpoint.
- `wp_backup_restore` `wp_content` scope is manifest-verify only in v1.1; deep restore requires batch fs-write API (v1.2).

## [1.0.0] — 2026-05-25 — Stable (schema-frozen)

### Schema-freeze promise

All MCP tool **names** and **required input fields** locked. Breaking changes require a **major bump**. Adding optional input fields, adding output fields, adding new tools = minor. Bug fixes + dep bumps = patch.

The frozen schema:
- **46 MCP tools** with `rolepod_wp_*` prefix (connect + lifecycle + atomic + typed CRUD + adapters + composites + memory + companion-gated power).
- Schema source: `src/schema/tools.ts` (zod). Exported to `dist/schemas/tools.json` on build.
- Replay bundle format `v1` (`src/bin/replay.ts`).
- Companion REST namespace `/wp-json/wplab/v1/` with 8 endpoints.

### Locked

- Tool names + required fields.
- Profile names: strict / personal / power.
- Target kinds: local / rest / ssh / docker.
- Allow-list categories + never-allowed list (W-005).
- Filesystem scope rules (W-006).
- DB SELECT-only guard (W-007).
- Production guard semantics (W-008).
- Credential vault layout (W-018).
- Memory directory layout (W-028).
- Replay bundle JSON shape.

### Not locked

- Internal Target interface methods may grow (additive only).
- Composite implementations may improve.
- Adapter slate may expand (new plugins post-v1.0 are minor bumps).
- Companion v1.0+ may add new endpoints (additive).

### Pairs with

- `rolepod-wplab-companion` **v1.0** — schema-frozen alongside; audit log format frozen, capability map locked.

### Maintainer next actions (post-tag)

- npm publish `@rolepod/wplab`.
- Submit `rolepod-wplab-companion` to wordpress.org plugin directory (gated on WP review).
- External security audit per `SECURITY.md` "v1.0 audit scope" section.

## [0.5.0] — 2026-05-25 — OSS launch

### Added — Governance + docs

- **CONTRIBUTING.md** — license hygiene, quality gates, contribution checklist for new tools / adapters / companion endpoints, single-backend rule, DCO sign-off.
- **CODE_OF_CONDUCT.md** — Contributor Covenant v2.1.
- **SECURITY.md** — supported-versions matrix, 90-day private disclosure window, threat model for Node MCP + companion, in-scope items for v1.0 external audit.
- **.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md** — structured intake.

### Pairs with

- `rolepod-wplab-companion` v0.2 (unchanged for v0.5).

### Tests

- 117 unit + smoke green. 46 MCP tools. `claude plugin validate ./ --strict` pass.

### Not in v0.5 (deferred to v1.0)

- npm publish to `@rolepod/wplab` — requires npm org claim + publish workflow.
- wordpress.org plugin directory submission for companion — requires WP review.
- Astro docs site (RECIPES.md remains the primary doc surface).
- Real replay tool dispatch (currently stub).
- External security audit.
- Conformance test suite for 3rd-party adapters.

## [0.4.0] — 2026-05-25

### Added — Polish

- **Replay bundle format v1.** Schema in `src/bin/replay.ts`. CLI: `rolepod-wplab replay <bundle.json>`. v0.4 stub-dispatches calls (logs only); v0.5 wires actual in-process MCP CallTool dispatch loop.
- **Dockerfile** for ghcr.io publish target. Multi-stage (build node20 → runtime node20-alpine). Entrypoint = `rolepod-wplab serve`.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — Node 20+22 × ubuntu+macos matrix; typecheck + build + test + lint + prettier + docker build (no push).
- **docs/RECIPES.md** — 10 concrete end-to-end recipes (connect local/remote, scaffold block, audit multi-site, migrate plugins, hook debug, bulk Woo update, memory recall, execute-php, docker fixture).

### Changed

- `rolepod-wplab` CLI usage line lists all subcommands: serve | doctor | credentials | memory | replay | smoke.

### Not yet implemented (deferred to v0.5)

- Replay actually executes tool calls (currently stubs to logs).
- Docs site (Astro). RECIPES.md serves as v0.4 doc surface.
- WooCommerce optional pack (existing adapter writes cover most use cases).
- Adapter test framework with real fixture coverage.

## [0.3.0] — 2026-05-25

### Added — Multi-target + cross-target composites + SEO/i18n adapters

**New target kinds (W-009):**
- `SshTarget` — node-ssh based. Supports private_key_path or password auth. wp-cli via ssh exec; fileRead/fileWrite via SFTP.
- `DockerTarget` — dockerode based. `docker exec` per call. File ops via stdin-piped tee. Demuxes docker stream multiplex header.
- `factory.openTarget` handles 4 kinds: local | rest | ssh | docker.

**New MCP tools (8 — total 46, was 34 in v0.2):**
- `rolepod_wp_connect_ssh { host, user, wp_path, port?, private_key_path?, password? }`
- `rolepod_wp_connect_docker { container_name, wp_path?, docker_host?, docker_socket_path? }`
- `rolepod_wp_audit_many { target_ids[], report_format? }` — fan out audit across N targets, consolidate.
- `rolepod_wp_migrate_data { source_target_id, dest_target_id, scope, allow_destructive:true, confirm? }` — v0.3 supports plugin_versions only (install/upgrade dest to match source).
- `rolepod_wp_wpml_read { target_id, scope, domain?, post_id? }` — languages / string_translations / post_translations.
- `rolepod_wp_yoast_read { target_id, scope, post_id? }` — post_meta / settings.
- `rolepod_wp_rankmath_read { target_id, scope, post_id? }` — post_meta / settings.

**Adapters (3 new):**
- `wpml/read` — supportedRange 4.5 — 4.7.
- `yoast/read` — supportedRange 21.0 — 23.5.
- `rankmath/read` — supportedRange 1.0.200 — 1.0.220.

### Deps

- `@types/dockerode` added to devDependencies.
- `node-ssh` + `dockerode` (optionalDependencies from v0.0) now actually pulled.

### Pairs with

- `rolepod-wplab-companion` v0.2 (unchanged for v0.3).

### Tests

- 117 unit + smoke green (smoke asserts 46 tools).
- claude plugin validate --strict pass.
- Lint + prettier + typecheck clean.

## [0.2.0] — 2026-05-25

### Added — Companion online + Memory + Power tools

**Memory (W-028):**
- `MemoryStore` — per-site file-based storage at `~/.config/rolepod-wplab/memory/<site-slug>/` (mode 0700 dir, 0600 files). Layout: meta.json + site.md + notes.md (append-only) + conventions.md (versioned append) + runbooks/*.md.
- `rolepod_wp_memory_recall { target_id, query?, kind? }` — substring + kind filter.
- `rolepod_wp_memory_note { target_id, content, kind?, runbook_name?, tags? }` — append note / version convention / replace runbook.
- `rolepod_wp_memory_list { target_id }` — metadata-only file listing.
- CLI: `rolepod-wplab memory show | list | clear | export`.

**Companion bridge + power tools (W-003R, W-004R):**
- `src/companion/Bridge.ts` — handshake + session token mgmt + AST pre-screen + auto-refresh on 401.
- `src/safety/AstScreen.ts` — token-blocklist screen (defence in depth with companion v0.1+ PHP-side screen). Rejects eval/assert/system/exec/shell_exec/proc_open/popen/pcntl_*/dl/backtick/dynamic-include.
- `rolepod_wp_execute_php { target_id, payload, timeout_ms?, confirm:true }` — requires `ROLEPOD_WPLAB_PROFILE=power`.
- `rolepod_wp_introspect { target_id, scope, include_values? }`.
- `rolepod_wp_hook_state { target_id, hook, kind? }` — specialized wrapper over introspect(scope=hooks).

**Adapter writes + Bricks (W-023 extended):**
- `elementor/write.updatePageData` — auto-backup `_elementor_data` before overwrite.
- `woocommerce/write.updateProduct` + `bulkUpdatePrices` (via /wc/v3/products/batch).
- `acf/write.setPostMeta` — ACF Pro REST first, wp-cli fallback.
- `bricks/read` adapter — listPages + getPage (parses `_bricks_page_content_2`). supportedRange 1.8 — 1.10.
- 4 new MCP tools: `wp_elementor_write`, `wp_woo_write`, `wp_acf_write`, `wp_bricks_read`. All writes enforce production guard.

**Composites (5 total):**
- `rolepod_wp_scaffold_block` — generates block.json + index.js + render.php (or save) + style.css.
- `rolepod_wp_scaffold_plugin` — main PHP + readme + uninstall + optional rest_endpoint/admin_page/cli_command stubs.
- `rolepod_wp_scaffold_theme` — block-theme skeleton (style.css + theme.json + functions.php + templates).
- `rolepod_wp_audit_security` — chains wp-cli checks + writes audit-report.md/.json.
- `rolepod_wp_migrate_dryrun` — diffs two targets across plugin_versions / options / users / posts.

**Shipped skills (6 new — total 10):**
- `wp-execute-php` (companion-gated, power profile required)
- `wp-introspect` (companion-gated)
- `wp-edit-elementor` (adapter)
- `wp-audit-woo` (adapter composite)
- `wp-scaffold-theme`
- `wp-migrate-dryrun`

**MCP tools: 34 total** (was 19 in v0.1). All registered + tools/list smoke updated to assert exact list.

### Changed

- `Target` interface: `TargetKind` unchanged but bridge layer now exercises `Target.rest()` for companion communication on all target kinds (RestTarget today; v0.3 SSH/Docker via companion remote install).
- `loadProfile()` recognizes `power` profile (was placeholder in v0.1 schema).

### Pairs with

- `rolepod-wplab-companion` v0.2 — adds `/wp-cli` (bundled wp-cli proxy), `/fs-read`, `/fs-write`, `/php-session`, `/request-observer`. `execute-php` default-enabled.

### Tests

- 117 unit + smoke tests green (memory 17 + AstScreen 13 added).
- `claude plugin validate ./ --strict` passes.
- Lint + prettier + typecheck all clean.

## [0.1.0] — 2026-05-25

### Added — PoC complete (Path C foundation)

**Runtime layer:**
- `RestTarget` (W-027) — remote WordPress via HTTPS REST + optional companion. No host wp-cli, no SSH needed. Closes shared-hosting gap.
- `restClient` — Basic-Auth App Password, content-type sniffing, `?rest_route=` fallback for permalink-disabled WP, AbortController timeout, redacts auth from error context.
- `Target` interface gains `companion: CompanionStatus | null` field. `executePhp` / `introspect` are optional methods (companion-gated).
- Companion handshake at every target-open. 200 + power profile + non-prod → power tools available. Else → power tools unregistered.

**Credentials (W-018, W-027):**
- Vault interface: `add` / `get` / `list` / `remove` / `touch`.
- `KeychainVault` — macOS Keychain via `security` binary + sidecar metadata JSON.
- `FileVault` — JSON at mode 0600 (Linux + portable fallback).
- `makeVault()` — auto-detects platform; `ROLEPOD_WPLAB_VAULT=file|keychain` override.
- `canonicalizeSite()` — lowercase hostname extraction.
- `Credential` type carries `appPassword` (raw secret, never serialized to MCP responses or audit log).
- `prompt.ts`: `ask` / `askSecret` (raw-mode no-echo) / `confirm` — no extra deps.
- CLI subcommand `rolepod-wplab credentials <add|list|show|remove|test> [site]`.

**MCP tools — 19 total (was 5 in v0.0):**

Connectivity + lifecycle:
- `rolepod_wp_connect_local { path }`
- `rolepod_wp_connect_rest { url, credential_ref?, require_companion? }` (NEW)
- `rolepod_wp_disconnect { target_id }` (NEW)

Atomic surface:
- `rolepod_wp_cli_run { target_id, args, allow_destructive?, timeout_ms? }`
- `rolepod_wp_health_check { target_id }`
- `rolepod_wp_file_read { target_id, path }`
- `rolepod_wp_file_write { target_id, path, content, mode?, backup?, confirm_unsafe_path? }`
- `rolepod_wp_post_get { target_id, id, context?, type? }` (NEW)
- `rolepod_wp_post_list { target_id, type?, per_page?, page?, search?, status?, ... }` (NEW)
- `rolepod_wp_post_create { target_id, title, content, status?, ... }` (NEW)
- `rolepod_wp_post_update { target_id, id, title?, content?, status?, ... }` (NEW)
- `rolepod_wp_option_get { target_id, name }` (NEW)
- `rolepod_wp_option_set { target_id, name, value, confirm? }` (NEW)
- `rolepod_wp_user_list { target_id, per_page?, page?, search?, role? }` (NEW)
- `rolepod_wp_db_query { target_id, sql, allow_write?, confirm? }` (NEW)
- `rolepod_wp_rest_request { target_id, method, path, query?, body?, headers? }` (NEW)

Adapter-backed (read-only v0.1, W-023):
- `rolepod_wp_elementor_read { target_id, page_id?, type?, per_page? }` (NEW)
- `rolepod_wp_woo_read { target_id, scope, group?, per_page?, search?, status? }` (NEW)
- `rolepod_wp_acf_read { target_id, scope, group_key?, post_id? }` (NEW)

**Adapters (src/adapters/):**
- `_contract.ts` — `Adapter<TRead, TWrite>` interface + `AdapterUnavailableError`.
- `elementor/read` — listPages (REST), getPage (wp-cli post meta; RestTarget needs companion v0.2). supportedRange: 3.18 — 3.22.
- `woocommerce/read` — products, orders, settings_groups, settings_in_group, shipping_zones, payment_gateways via `/wc/v3` REST. supportedRange: 8.0 — 9.4.
- `acf/read` — fieldGroups, fieldsInGroup, postMeta via wp-cli + ACF Pro REST fallback. supportedRange: 6.0 — 6.3.

**Safety:**
- `DbGuard` (W-007) — SELECT/SHOW/DESCRIBE/DESC/EXPLAIN allow-list. Strips leading comments + handles `WITH ... SELECT` (CTE). `DbWriteBlockedError` on violation.
- All write tools enforce `ProdGuard` (W-008) unless `confirm: true`.

**Plugin layout (Claude Code, verified against https://code.claude.com/docs/en/plugins-reference + /skills):**
- `.claude-plugin/plugin.json` — metadata only (NO inline `mcpServers`; that lives in `.mcp.json`).
- `.mcp.json` at plugin root — declares MCP server pointing at `${CLAUDE_PLUGIN_ROOT}/dist/bin/rolepod-wplab.js`.
- `skills/wp-health-check/SKILL.md`
- `skills/wp-scaffold-block/SKILL.md`
- `skills/wp-scaffold-plugin/SKILL.md`
- `skills/wp-audit-security/SKILL.md`
- `claude plugin validate ./ --strict` passes.

Cursor + Codex + Gemini manifests NOT shipped this release — schemas not yet verified per SCHEMA-BOUND-file policy. Deferred to v0.5.

**Tests — 87 green:**
- `tests/unit/server.test.ts` (18) — server boot + AllowList + ProdGuard + FsScope
- `tests/unit/TargetRegistry.test.ts` (8) — lifecycle + idle close + collision
- `tests/unit/profile-load.test.ts` (6) — env / file / malformed
- `tests/unit/stripPhpNoise.test.ts` (9)
- `tests/unit/credentials.test.ts` (16) — canonicalize + FileVault round-trip + permissions + corruption
- `tests/unit/restClient.test.ts` (12) — https-only + auth header + URL form fallback + timeout + redaction + query encoding
- `tests/unit/DbGuard.test.ts` (15) — SELECT/SHOW/DESC/EXPLAIN allow + CTE + INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER block + comments
- `tests/smoke/mcp-handshake.test.ts` (3) — spawn dist + JSON-RPC + tools/list asserts 19 tools

### Changed

- `Target.kind` type now includes `'rest'`.
- `runtime/wpCli.ts` adds `stripPhpNoise()` filter for wp-cli 2.12 on PHP 8.4 deprecation noise.
- `wp_health_check` DB probe switched from `wp db check` (needs host mysqlcheck) to `wp option get siteurl` (PHP mysqli only).

### Pairs with

- `rolepod-wplab-companion` v0.1 — optional WP plugin providing `/wp-json/wplab/v1/{handshake,introspect,execute-php}` endpoints. execute-php DISABLED by default in v0.1.

## [0.0.0] — 2026-05-25

### Added — personal-use scaffold

- Repo plumbing: TypeScript + tsup + vitest + oxlint + prettier.
- MCP server skeleton (stdio).
- `LocalTarget` runtime (wp-cli + REST stub + scoped fs).
- 5 atomic tools.
- Safety primitives: AllowList + FsScope + ProdGuard.
- 3-profile loader (`strict` / `personal` / `power` slot).
- Docker WP fixture (`tests/fixtures/`) for local dogfood.
- 44 unit + smoke tests.
