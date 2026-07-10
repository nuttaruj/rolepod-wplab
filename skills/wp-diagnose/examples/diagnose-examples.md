# wp-diagnose — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — "site is slow"

### Bad

```text
User: "site is slow"
Lead: calls wp_diagnose { target_id, scopes: ["broken_images"] }
→ 4 minutes later: "no broken images found"
```

Issues: picked the slowest, least-relevant scope. Broken images is a content quality probe, not a perf probe.

### Good

```text
User: "site is slow"
Lead: picks the perf-relevant scopes:
  - diagnose { scopes: ["slow_queries", "large_options"] }
  - cache_tool { op: "inspect" }

Probes run in ~10s total.

Aggregated findings:
  - HIGH: autoload row `_transient_doing_cron` = 12 KB (stale lock)
  - MEDIUM: autoload row `wp_user_roles` = 8 KB (heavy custom role plugin)
  - MEDIUM: object cache type = "Default" (no Redis/Memcached)
  - LOW: 1 slow query > 2s (`wp_options` SELECT without `WHERE`)

Top 5 surfaced. Artifact path printed.
Next-action recommendation:
  - Clear stale cron lock via wp-execute-php
  - Audit the heavy custom role plugin via wp-edit-plugin
  - Install Redis Object Cache for the cache type fix
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Scopes picked | irrelevant (broken_images) | targeted (slow_queries + large_options + cache) |
| Time spent | 4 min | 10 s |
| Findings actionable | no | yes (3 concrete next steps) |
| Artifact written | yes (empty) | yes (4 ranked findings) |

## Scenario 2 — reading the audit_security report

### Bad

```text
audit_security returns:
  - INFO: 28 plugins outdated
  - INFO: 3 themes outdated
  - INFO: WordPress core: 6.4.2 (current: 6.5.0)
  - INFO: admin user login = "admin"
  - INFO: WP_DEBUG = true

Lead: "looks like some plugins are outdated, no big deal"
```

Issues: report dumped as INFO. Lead missed that `admin user login = "admin"` is a CRITICAL credential-stuffing vector and `WP_DEBUG = true on prod` is a HIGH info disclosure.

### Good

```text
Aggregator re-classifies:
  - CRITICAL: admin user login = "admin" (credential stuffing target)
  - HIGH: WP_DEBUG = true (info disclosure on errors)
  - HIGH: WordPress core 6.4.2 → 6.5.0 (security release)
  - MEDIUM: 12 of 28 outdated plugins have CVEs in patchstack mirror
  - LOW: 16 outdated plugins with no known CVEs
  - LOW: 3 outdated themes

Top 5 surfaced. User shown the CRITICAL first.
Next-action recommendation:
  - CRITICAL: rename "admin" user to something unique
    (cannot auto — user must change login + tell WP via UI)
  - HIGH: set WP_DEBUG=false via `wp config set WP_DEBUG false --raw` (wp-cli rewrites wp-config.php safely; do not hand-edit it with fs-write or execute-php)
  - HIGH: update WordPress core (via wp-content REST or wp-cli)
  - MEDIUM: update 12 CVE-exposed plugins first (sorted list)
  - LOW: rest deferable
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Severity assigned | flat INFO | proper CRITICAL/HIGH/MEDIUM/LOW |
| Credential vector caught | no | yes |
| Info disclosure caught | no | yes |
| User shown prioritized | no | yes |
| Next-action mapped | none | per-finding skill handoff |
