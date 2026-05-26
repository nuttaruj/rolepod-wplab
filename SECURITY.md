# Security Policy

## Supported versions

Until v1.0, only the **latest minor version** receives security fixes. After v1.0, the latest 2 minor versions.

| Version | Supported |
|---|---|
| 0.x latest | ✅ |
| < latest 0.x | ❌ |

## Reporting a vulnerability

**Do NOT open a public GitHub issue.** Email `nuttaruj@gmail.com` with:

1. Affected component (`@rolepod/wplab` or `rolepod-wp` — both, or either).
2. Affected version(s).
3. Reproduction steps + minimum impact statement.
4. Suggested fix if you have one (optional).

You'll receive an acknowledgement within **7 calendar days**. We commit to a **90-day private disclosure window** — after that, the issue may be disclosed publicly with or without a fix, at your or our discretion.

## Threat model

The Node MCP (`@rolepod/wplab`):

- Runs as the user's local process — same trust boundary as the AI CLI (Claude Code, etc.).
- Reads credentials from OS keychain / `~/.config/rolepod-wplab/credentials.json` (mode 0600).
- Talks to remote WordPress over HTTPS (refuses http://) with Application Password Basic auth.
- Never logs credentials in MCP responses, audit logs, or artifacts.
- AST-screens PHP payloads before sending to companion (defence in depth with companion-side screen).

The companion WP plugin (`rolepod-wp`):

- Lives inside WordPress as a PHP plugin.
- Endpoints default OFF on activation — admin must explicitly enable.
- All endpoints require `manage_options` capability.
- `execute-php` requires per-session token + AST screen (Node + PHP side) + production-block (unconditional, no override).
- Append-only audit log on disk (file mode 0600) + capped `wp_options` array.

## Known scope limitations

- v0.2 — v0.3 Node-side AST screen uses regex/token blocklist (not full PHP AST). Companion-side `nikic/php-parser` lands in companion v0.3+.
- File-permission audit not yet implemented (audit_security composite v0.4 will add).
- No fuzz testing of companion endpoints yet — planned for v1.0 pre-launch external review.

## In scope for v1.0 external audit

- Companion REST endpoint authentication + authorization.
- Node-side credential vault storage (keychain + file fallback) — confidentiality + integrity.
- AST screen bypass attempts (Node + PHP side).
- Production guard bypass attempts.
- Session token replay + brute-force.
- Audit log tampering.
- Multi-target session isolation (one target's bridge cannot affect another).
