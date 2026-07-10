# Diagnose Report — {{siteurl}}

**target_id:** `{{target_id}}`
**run_id:** `{{run_id}}`
**run_at:** {{timestamp_utc}}
**scopes_run:** {{scopes_csv}}
**target_kind:** {{kind}}

## Verdict

{{
  CRITICAL count > 0 → "BLOCKED — {{n_critical}} critical findings require fix before proceeding."
  HIGH count > 0    → "DEGRADED — {{n_high}} high-severity findings should be addressed soon."
  MEDIUM/LOW only   → "OK with observations — {{n_total}} findings, none blocking."
  all empty         → "CLEAN — no findings."
}}

## Top findings (sorted by severity)

| # | Severity | Probe | Finding | Recommendation |
|---|---|---|---|---|
| 1 | {{sev_1}} | {{probe_1}} | {{finding_1}} | {{recommend_1}} |
| 2 | {{sev_2}} | {{probe_2}} | {{finding_2}} | {{recommend_2}} |
| 3 | {{sev_3}} | {{probe_3}} | {{finding_3}} | {{recommend_3}} |
| 4 | {{sev_4}} | {{probe_4}} | {{finding_4}} | {{recommend_4}} |
| 5 | {{sev_5}} | {{probe_5}} | {{finding_5}} | {{recommend_5}} |

(Full {{n_total}} findings listed below.)

## All findings by probe

### audit_security

{{audit_security_findings | yaml-block | "(not run)"}}

### plugin_conflict_probe

{{plugin_conflict_findings | yaml-block | "(not run)"}}

### slow_queries

{{slow_queries_findings | yaml-block | "(not run)"}}

### large_options

{{large_options_findings | yaml-block | "(not run)"}}

### broken_images

{{broken_images_findings | yaml-block | "(not run)"}}

### php_errors

{{php_errors_findings | yaml-block | "(not run)"}}

### cron_tool list

{{cron_findings | yaml-block | "(not run)"}}

### cache_tool inspect

{{cache_findings | yaml-block | "(not run)"}}

### mail_test

{{mail_findings | yaml-block | "(not run)"}}

### user_session_list

{{user_session_findings | yaml-block | "(not run)"}}

## Next actions

{{
  Map each CRITICAL/HIGH finding to the skill that fixes it:
  - outdated core/plugin/theme → wp-content (REST POST /wp/v2/plugins update)
  - weak admin login=admin → user task (cannot auto)
  - WP_DEBUG=true on prod → `wp config set WP_DEBUG false --raw` (a wp-config.php constant, not an option)
  - slow autoload row → wp-edit-plugin (locate plugin) or direct option fix
  - SMTP not working → wp-edit-plugin (configure SMTP plugin)
}}
