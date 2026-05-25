---
name: wp-audit-security
description: Audit a WordPress target against known vulnerabilities, outdated core/plugins/themes, weak users, file-permission issues, debug flags.
---

## When to use

- Before deploying a WP site or merging WP-touching changes.
- After installing a third-party plugin/theme.
- On a regular cadence as a smoke check (CI cron job).
- After a security advisory drops for a major WP plugin.

## When NOT to use

- For deep penetration testing. Use specialised tools (WPScan paid feed, Burp Suite, OWASP ZAP).
- For runtime exploit testing — wplab audits config + version posture, not active vulnerabilities.

## Inputs

- `target_id` — connected WP target.
- `report_format?` — `markdown` (default, human-readable) or `json` (machine-readable for CI).

## Outputs

- `run_id`
- `wp_core_outdated` — boolean
- `outdated_plugins[]` — `{ slug, current, latest }`
- `outdated_themes[]` — same shape
- `known_vulnerable_plugins[]` — `{ slug, version, advisory_url }` (CVE lookup via public source, cached locally)
- `weak_admin_users[]` — `{ login, reason }` (e.g. user named "admin", easy-to-guess username)
- `file_permission_issues[]` — `{ path, mode, recommended }`
- `wp_debug_on` — boolean (WP_DEBUG=true is fine on dev, smell on prod)
- `report_path` — markdown/json file on disk for the full report

## Process

1. Construct `rolepod_wp_audit_security` composite input.
2. Call the tool — composite chains: wp core check-update, wp plugin status, wp theme status, wp user list with role filter, file stat on key paths, wp_debug detection, CVE feed lookup.
3. Group findings by severity (CVE matches > outdated plugins > weak users > file perms > debug flags) and surface critical ones inline in the chat.
4. Save full report to `./.rolepod-wplab/artifacts/<run_id>/audit-report.md` and reference path in reply.

## If the tool is unavailable

Same handling as other shipped skills.

## Examples

```
User: "audit security"
Lead → rolepod_wp_audit_security { target_id: "tgt_8585..." }
Lead reply: "Found 2 critical, 3 medium issues:
              CRITICAL: Bricks v1.8.5 has CVE-2024-XXXX (auth bypass) — upgrade to 1.9.0+
              CRITICAL: User 'admin' exists with role administrator — rename
              MEDIUM:   3 plugins outdated (akismet, hello, contact-form-7)
              MEDIUM:   wp-config.php is world-readable (644 → 600)
              MEDIUM:   WP_DEBUG enabled on production-matched siteurl
              Full report: ./.rolepod-wplab/artifacts/wplab_2026.../audit-report.md"
```
