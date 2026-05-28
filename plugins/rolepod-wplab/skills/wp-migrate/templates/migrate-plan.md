# Migration Plan — {{source_siteurl}} → {{dest_siteurl}}

**run_id:** `{{run_id}}`
**plan_id:** `{{plan_id}}`
**run_at:** {{timestamp_utc}}
**dryrun_only:** {{true | false}}
**scope:** {{full | db | wp-content | tables: [...] | posts: [...]}}

## Pre-flight

- Source health: {{source_health_summary}}
- Destination health: {{dest_health_summary}}
- Destination diagnose findings (HIGH+): {{dest_diagnose_high_count}}

## Production guard

- Destination is production-matched: {{yes / no}}
- Type-back hostname required: {{yes / no}}
- User typed back: `{{user_typed_hostname | "(not yet)"}}`
- Match: {{exact / mismatch / pending}}

## Migration plan

### Database

| Table | Rows source | Rows dest | Action | Conflict? |
|---|---|---|---|---|
| `wp_options` | {{n}} | {{n}} | merge / replace / skip | {{none / list}} |
| `wp_posts` | {{n}} | {{n}} | merge / replace / skip | {{none / id-collision list}} |
| `wp_postmeta` | {{n}} | {{n}} | merge / replace / skip | {{none / list}} |
| `wp_users` | {{n}} | {{n}} | skip (user table excluded by default) | (n/a) |
| ... | | | | |

### Filesystem

| Path | Source size | Dest action | Conflict? |
|---|---|---|---|
| `wp-content/uploads/` | {{MB}} | sync / replace / skip | {{file count diff}} |
| `wp-content/themes/` | {{MB}} | sync | (n/a) |
| `wp-content/plugins/` | {{MB}} | sync | {{plugins to deactivate first}} |

### URL rewrites

- `{{source_url}}` → `{{dest_url}}` in `wp_options.siteurl` + `wp_options.home` + serialized data scan.
- {{n}} rows scheduled to rewrite.

## Risk assessment

| Risk | Severity | Mitigation |
|---|---|---|
| Plugin version skew (X plugins newer on source) | HIGH | manually update dest first, OR migrate plugins in same pass |
| User table excluded → admin login carries dest creds | INFO | by design; document for user |
| Production destination | CRITICAL | type-back required + backup before apply |

## Backup plan

- Pre-apply backup file: `{{backup_path | "(not yet created)"}}`
- Backup size: {{MB | "(unknown)"}}
- Restore command: `rolepod_wp_backup_restore { target_id: <dest>, backup_path: "<above>" }`

## Apply checklist

- [ ] Source + destination both green on health-check
- [ ] Destination diagnose: 0 NEW HIGH/CRITICAL since plan was generated
- [ ] Dryrun completed
- [ ] User confirmed plan
- [ ] If prod: user typed back hostname verbatim
- [ ] Backup created + path recorded
- [ ] {{n_minutes_since_dryrun}} minutes since dryrun (must be ≤5)
- [ ] Ready to apply

## Post-apply checklist

- [ ] wp-health-check on destination → all flags green
- [ ] wp-diagnose on destination → 0 NEW HIGH/CRITICAL vs pre-migration
- [ ] Spot-check 3 URLs: {{url_1}}, {{url_2}}, {{url_3}}
- [ ] If any failure → run backup_restore + report
