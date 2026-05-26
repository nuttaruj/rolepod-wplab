# WP Health Check — {{siteurl}}

**target_id:** `{{target_id}}`
**run_at:** {{timestamp_utc}}

## Versions

- WordPress: `{{wp_version}}`
- PHP: `{{php_version}}`
- Companion: `{{companion_version | "(not installed)"}}`

## Reachability

| Check | Result |
|---|---|
| db_ok       | {{db_ok ✓ / ✗}} |
| rest_ok     | {{rest_ok ✓ / ✗}} |
| wp_cli_ok   | {{wp_cli_ok ✓ / ✗}} |
| companion_ok | {{companion_ok ✓ / ✗}} |

## Companion capabilities

{{capabilities | bulleted-list | "(companion absent)"}}

## Warnings ({{warnings.length}})

{{warnings | bulleted-list-verbatim | "(none)"}}

## Verdict

{{
  if all checks pass → "READY — proceed."
  if any check fails → "BLOCKED on <flag>. Fix: <from interpret table>. Re-run when fixed."
}}
