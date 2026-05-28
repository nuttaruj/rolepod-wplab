---
name: wp-diagnose
description: Multi-probe diagnostic + security audit of a connected target — plugin conflicts, slow queries, large autoload options, broken images, PHP errors, outdated core/plugins/themes, weak admins. Phase = Debug.
when_to_use: user asks "what is wrong with this site / audit security / check for problems / why is the site slow", OR after a regression spike, OR before a migration to a new environment
tier: 1
phase: debug
mode:
  standalone:
    role: primary debug entry — reproduce → trace → fix WP issue
    output: full debug report (symptom, trace, root cause, fix)
  with-rolepod:
    role: WP-specific evidence provider
    caller: rolepod:debug-issue
    output: WP-runtime findings only (error log lines, hook trace, query log) — no fix flow
---

## Mode selection

If the marker file `$GIT_ROOT/.rolepod/parent-active` exists, follow the
**with-rolepod** mode declared in the frontmatter — produce reduced output
suited to the parent's `debug-issue` phase orchestrator. Skip the fix-flow
narrative; emit WP-runtime findings only (error log lines, hook trace, query
log) and let the parent decide remediation.

Otherwise, follow **standalone** mode — run the full diagnostic flow described
below.

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || GIT_ROOT="$PWD"
if [ -f "$GIT_ROOT/.rolepod/parent-active" ]; then
  MODE=with-rolepod
else
  MODE=standalone
fi
```

# WP Diagnose

Heavyweight probe + audit. Multi-second, ranks findings by severity, writes a markdown / JSON artifact. Subsumes audit_security + audit_many + cron/cache/mail/user_session inspection. The "what is wrong here" entry point — `wp-health-check` answers "is it up", this answers "is it healthy at depth".

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER use `wp-diagnose` as a pre-flight check before every tool call — it is multi-second and writes artifacts; for cheap pre-flight use `wp-health-check`.
2. NEVER skip the artifact write — the per-run report at `./.rolepod-wplab/artifacts/<run_id>/diagnose-report.md` is the canonical handoff to the user / to ticket systems / to `wp-migrate`.
3. ALWAYS surface CRITICAL findings before INFO findings — a 6-month-outdated WordPress core with known CVEs hidden under 80 lines of "autoload is 60 KB" wastes the user's first read.
</EXTREMELY-IMPORTANT>

## When to use

- "Audit this site for security issues."
- "Why is this site slow?"
- "Are any plugins out of date?"
- "Check for plugin conflicts."
- "Show me PHP errors."
- "Run a full diagnostic before I migrate."
- "Audit these 20 sites" → `audit_many` orchestrator.

Skip when:
- "Is it up?" → `wp-health-check`.
- "What's in `wp_options` for plugin X?" → `wp-introspect`.

## Boundary

Owns:
- `rolepod_wp_diagnose` (5 scopes: plugin_conflict_probe / slow_queries / large_options / broken_images / php_errors).
- `rolepod_wp_audit_security` (core/plugin/theme outdated + weak admins + WP_DEBUG flag).
- `rolepod_wp_audit_many` (parallel audit across N target_ids).
- `rolepod_wp_cron_tool` op=list (inspect schedule).
- `rolepod_wp_cache_tool` op=inspect (object-cache type + transient counts).
- `rolepod_wp_mail_test` (SMTP / wp_mail probe).
- `rolepod_wp_user_session_list` (active sessions for security view).
- Writing the ranked report artifact.

Does not own:
- Applying fixes → respective edit skills (`wp-content`, `wp-edit-plugin`, `wp-execute-php`, `wp-migrate`).
- Raw state read (no analysis) → `wp-introspect`.
- Lightweight ping → `wp-health-check`.

Return / hand off:
- Findings include outdated plugins → user/`wp-content` to update via REST.
- Findings include weak admins → user task (cannot auto-fix passwords).
- Findings include WP_DEBUG=true on prod → `wp-edit-plugin` or direct option_set.
- Findings span 20 sites → `audit_many` for the consolidated index.

## Inputs to gather

- target_id (single) OR target_ids (array, for audit_many).
- For diagnose: `scopes` array (default = all except broken_images, which is expensive).
- `report_format` (markdown / json, default markdown).

## Workflow

### 1. Pick scopes by user intent

| User intent | Scopes |
|---|---|
| "security audit" | audit_security + user_session_list |
| "site is slow" | diagnose (slow_queries + large_options) + cache_tool inspect |
| "plugin conflicts" | diagnose (plugin_conflict_probe + php_errors) |
| "before migration" | audit_security + diagnose (all scopes) + cron_tool list |
| "full sweep" | every scope above |
| "audit 20 sites" | audit_many |

### 2. Run probes

Most run in parallel (audit_many always does). For single-target multi-scope: sequential to keep companion side cool.

### 3. Rank findings

Severities: CRITICAL > HIGH > MEDIUM > LOW > INFO. The per-probe handler returns this already; the skill aggregates + sorts.

### 4. Write artifact

`./.rolepod-wplab/artifacts/<run_id>/diagnose-report.{md,json}` — per `templates/diagnose-report.md`.

### 5. Surface to user

Print TOP 5 findings (sorted by severity) + path to artifact. Do not dump all findings inline — that defeats the artifact's purpose.

## If a matching Rolepod agent is available

- `rolepod:security-engineer` for the audit_security pass interpretation.
- `rolepod:performance-engineer` for slow_queries + large_options + cache findings.
- `rolepod:qa-tester` for the full sweep + ticket creation.

## If no matching agent is available

1. Pick scopes.
2. Run probes (parallel where safe).
3. Aggregate + rank.
4. Write artifact.
5. Surface top 5 + artifact path.

## Output

Diagnose report — `templates/diagnose-report.md`. Canonical handoff format.

## Examples

Read when picking scopes for an unfamiliar site type or when interpreting a non-trivial finding:
- `examples/diagnose-examples.md` — good vs bad scope pick for "site is slow"; good vs bad reading of audit_security output.

## References

Inline only. Each probe's contract is documented in `src/tools/composite/wp_diagnose.ts` + `wp_audit_security.ts`. The artifact format is the template.

## Hard stops

- All scopes return empty → STOP, the companion may be misconfigured OR the probes ran against a target without companion (limited scopes). Surface "no data — re-run with companion v2.1+".
- audit_many called with 0 target_ids → STOP, ask user which sites.
- A scope returns 500 → STOP that scope only; continue others; mark partial in report.

## Full Rolepod enhancement

Full Rolepod adds historical trending: today's diagnose vs yesterday's, surfaces regressions explicitly. Standalone, the user compares manually via the artifact path.

## Next phase

- Findings → `wp-content` for option fixes, `wp-edit-plugin` for plugin config, `wp-execute-php` for runtime fixes, `wp-migrate` for "let's move to a cleaner host".
- Multi-site → consolidated `audit_many` index.
- All-clean → `wp-health-check` periodically going forward.
