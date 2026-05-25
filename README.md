# rolepod-wplab

**Status:** v0.0 — personal-use scaffold. Not yet published to npm; use locally via `npm link`.

a third-party plugin-class WordPress operations toolkit for AI coding agents — default-safe wp-cli + REST + scoped filesystem, opt-in companion plugin (`rolepod-wplab-companion`, separate repo) for `execute-php` + runtime introspection. MIT, sibling of [rolepod-uiproof](https://github.com/nuttaruj/rolepod-uiproof) in the rolepod ecosystem.

## Quick start (personal use)

```bash
git clone https://github.com/nuttaruj/rolepod-wplab.git
cd rolepod-wplab
npm install
npm run build
npm link

# Register with Claude Code:
claude mcp add wplab -- rolepod-wplab

# Verify:
rolepod-wplab doctor
```

## What ships in v0.0

- MCP server skeleton (stdio, single Node process).
- `LocalTarget` (filesystem + wp-cli + REST against a local WP install).
- 4 atomic tools: `rolepod_wp_connect_local`, `rolepod_wp_cli_run`, `rolepod_wp_health_check`, `rolepod_wp_file_write` (+ `_read`).
- Safety primitives: wp-cli allow-list, filesystem scope guard, production-host guard.
- Profile loader: `strict` (default) / `personal` / `power`. (`power` slot defined; companion lands in v0.1+.)
- 1 unit smoke test confirming server boots.

## What does NOT ship in v0.0

- SSH / Docker targets (v0.3).
- Composite tools and scaffolding skills (v0.1+).
- Companion-gated tools (`execute-php`, `introspect`) — v0.2 alongside companion plugin.
- Adapters for Elementor / WooCommerce / ACF (v0.1+).
- Plugin manifests (`.claude-plugin/`, `.cursor-plugin/`, `.codex-plugin/`) for marketplace install (v0.1+).
- Smoke fixture (docker-compose WP) — v0.1.

## Design brief

Full design context lives in [`brief/`](./brief/). Start with [`brief/00-INDEX.md`](./brief/00-INDEX.md).

Path C stance (W-026): same capability ceiling as a third-party plugin, default-safe posture, opt-in companion for runtime PHP context. See [`brief/05-license-positioning.md`](./brief/05-license-positioning.md) for the differentiation matrix.

## License

MIT — see [LICENSE](./LICENSE). Clean-room from [a third-party plugin](https://github.com/use-third-party/third-party) (AGPL-3.0); no a third-party plugin code was read or copied.
