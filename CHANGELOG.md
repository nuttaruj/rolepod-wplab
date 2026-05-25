# Changelog

All notable changes to `@rolepod/wplab` are documented here. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
