# rolepod-wplab

**Status:** v0.1.0 — PoC complete (Path C foundation). Not yet published to npm; use locally via `npm link` or `claude --plugin-dir`.

a third-party plugin-class WordPress operations toolkit for AI coding agents — default-safe wp-cli + REST + scoped filesystem, opt-in companion plugin ([`rolepod-wplab-companion`](https://github.com/nuttaruj/rolepod-wplab-companion)) for `execute-php` + runtime introspection. MIT, sibling of [rolepod-uiproof](https://github.com/nuttaruj/rolepod-uiproof) in the rolepod ecosystem.

## Two layers

| Layer | Install | Capability |
|---|---|---|
| **Default** | `claude --plugin-dir ./rolepod-wplab` (or marketplace once v0.5) | wp-cli + REST + scoped fs + 19 MCP tools (3 adapters for Elementor / WooCommerce / ACF read) |
| **Power** (opt-in) | + install [`rolepod-wplab-companion`](https://github.com/nuttaruj/rolepod-wplab-companion) WP plugin + `ROLEPOD_WPLAB_PROFILE=power` | adds `execute-php`, `introspect`, adapter writes (v0.2+) |

## Quick start (local dev)

```bash
git clone https://github.com/nuttaruj/rolepod-wplab.git
cd rolepod-wplab
npm install
npm run build

# Test with Claude Code:
claude --plugin-dir ./

# Or register globally:
npm link
claude mcp add wplab -- rolepod-wplab

# Verify:
rolepod-wplab doctor
```

## Connecting to a WP target

**Local install** (filesystem path):
```
> "เชื่อม WP ที่ /Users/me/Sites/my-wp"
Lead → rolepod_wp_connect_local { path: "/Users/me/Sites/my-wp" }
```

**Remote site** (REST + App Password):
```bash
# 1. WP admin → Users → Profile → Application Passwords → name "rolepod-wplab" → copy
# 2. Store locally (never echoed to chat):
rolepod-wplab credentials add walnutztudio.com
# Username: admin
# Application Password: ****
# ✓ stored in keychain
```
```
> "เชื่อม walnutztudio.com"
Lead → rolepod_wp_connect_rest { url: "https://walnutztudio.com" }
```

## 19 MCP tools available

**Connectivity:** `connect_local`, `connect_rest`, `disconnect`, `health_check`
**wp-cli passthrough:** `cli_run` (allow-listed)
**REST CRUD:** `post_{get,list,create,update}`, `user_list`, `rest_request`
**Options:** `option_{get,set}`
**Database:** `db_query` (SELECT-only by default)
**Filesystem:** `file_{read,write}` (scoped to `wp-content/{themes,plugins,uploads}` + `wp-config.php`)
**Adapters (read):** `elementor_read`, `woo_read`, `acf_read`

All prefixed `rolepod_wp_*`. Schemas in `src/schema/tools.ts`.

## Safety defaults

- **Allow-list** wp-cli (W-005) — `db reset`, `db drop`, `core multisite-convert` never run from MCP.
- **SELECT-only** DB queries (W-007) by default; `allow_write: true` + `confirm: true` on prod.
- **Scoped filesystem writes** (W-006) — `wp-content/{themes,plugins,uploads}` + `wp-config.php` only.
- **Production guard** (W-008) — siteurl glob match against `ROLEPOD_WPLAB_PROD_HOSTS`; all write tools require `confirm: true` on match.
- **HTTPS-only** RestTarget (W-017) — App Password never travels plaintext.
- **Credentials in OS keychain** (W-018) — never in chat history, never in audit log.

Power tools (with companion + `power` profile) add:
- **AST screen** for execute-php payloads (Node-side + companion-side, defence in depth).
- **Production-block unconditional** for execute-php — no override exists.
- **Append-only audit log** for every execute-php call (success + rejection).

## Skills (4 in v0.1)

- `/rolepod-wplab:wp-health-check` — diagnostic snapshot
- `/rolepod-wplab:wp-scaffold-block` — Gutenberg block scaffold (composite lands v0.2)
- `/rolepod-wplab:wp-scaffold-plugin` — plugin skeleton (composite lands v0.2)
- `/rolepod-wplab:wp-audit-security` — CVE + outdated + perms audit (composite lands v0.2)

v0.2 adds: `/wp-execute-php`, `/wp-introspect`, `/wp-edit-elementor`, `/wp-audit-woo`, `/wp-scaffold-theme`, `/wp-migrate-dryrun`.

## Sibling repos

- [`rolepod-wplab-companion`](https://github.com/nuttaruj/rolepod-wplab-companion) — optional WP plugin for runtime PHP context.
- [`rolepod-uiproof`](https://github.com/nuttaruj/rolepod-uiproof) — UI / mobile automation sibling.

## Design

Path C stance (W-026): same capability ceiling as a third-party plugin, default-safe posture, opt-in companion for runtime PHP context. Differentiation matrix + decision log in the [internal design brief](./brief/) (gitignored, maintainer-only — reconstructable from conversation context if lost).

## License

MIT — see [LICENSE](./LICENSE). Clean-room from [a third-party plugin](https://github.com/use-third-party/third-party) (AGPL-3.0); no a third-party plugin code was read or copied.
