# Changelog

All notable changes to `@rolepod/wplab` are documented here. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (v0.0 — personal-use scaffold)
- Repo plumbing: TypeScript + tsup + vitest + oxlint + prettier.
- MCP server skeleton (stdio).
- `LocalTarget` runtime (wp-cli + REST + scoped fs).
- 4 atomic tools: `rolepod_wp_connect_local`, `rolepod_wp_cli_run`, `rolepod_wp_health_check`, `rolepod_wp_file_write` / `_read`.
- Safety: wp-cli allow-list (read-only base), filesystem scope guard, production-host guard.
- Profile loader (`strict` / `personal` / `power`).
- Smoke unit test (server boot).
