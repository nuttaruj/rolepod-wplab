---
name: wp-health-check
description: Run a sub-5s diagnostic of a connected WordPress target — versions, db_ok, rest_ok, companion_ok, plugins/theme active set, warnings. Phase = Verify.
when_to_use: user asks "ping the site / is it healthy / what version is it / is the companion live", OR after a connect / pair / migration before continuing
tier: 1
phase: verify
mode:
  standalone:
    role: WordPress smoke test entry — full system check
    output: full health report with remediation suggestions
  with-rolepod:
    role: WP system snapshot provider
    caller: rolepod:check-work
    output: snapshot JSON (PHP version, plugin status, DB state) + manifest.json under .rolepod/evidence/
---

## Mode selection

If `$ROLEPOD_PARENT` is set to `1`, follow the **with-rolepod** mode declared
in the frontmatter — write a structured snapshot to the parent's evidence
directory using the `manifest.json` schema (protocol `rolepod/v1`,
phase `verify`). The parent's `check-work` consumes the manifest to decide
whether the change is ready to merge.

If `$ROLEPOD_PARENT` is unset or any other value, follow **standalone** mode —
print the full health report with remediation suggestions.

```bash
if [ "${ROLEPOD_PARENT:-}" = "1" ]; then MODE=with-rolepod; else MODE=standalone; fi
```

In with-rolepod mode, emit evidence with the `src/lib/rolepodEvidence.ts`
helper:

```ts
import { resolveEvidenceDir, writeManifest, makeRunTimestamp } from "../../src/lib/rolepodEvidence.js";
const ts = makeRunTimestamp();
const dir = resolveEvidenceDir("wp-health-check", ts);
writeManifest(dir, {
  skill: "wp-health-check",
  phase: "verify",
  status: warnings.length ? "warn" : "pass",
  summary: `WP ${wpVersion}, PHP ${phpVersion}, ${pluginCount} plugins active`,
  startedAt, finishedAt,
  artifacts: [{ type: "report", path: "./health.json" }],
  metadata: { wp_version: wpVersion, php_version: phpVersion, plugin_count: pluginCount },
});
```

# WP Health Check

Lightweight sanity probe. Cheap (<5s), idempotent, no writes. Answers "is this target workable for the next operation?" — NOT "what is wrong with this site overall" (that is `wp-diagnose`).

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER substitute `wp-health-check` for `wp-diagnose` — health-check is a sub-5s ping; deep probes (slow queries, plugin conflicts, php errors) belong to diagnose.
2. NEVER skip health-check after `wp-pair-setup` or `wp-migrate` apply — the pair/migrate's own success response does not prove the next-request side of the contract holds.
3. ALWAYS report the warnings array verbatim — warnings frequently identify the EXACT host config that breaks downstream tools (permalinks, exec disabled, mod_security stripping headers).
</EXTREMELY-IMPORTANT>

## When to use

- After `wp-pair-setup` or `wp-connect`.
- Before `wp-migrate` apply (verify destination reachable).
- After installing/activating a plugin.
- User asks any of: "is it up", "is it healthy", "what version", "is the companion working".

Skip when:
- User wants a full audit → `wp-diagnose`.
- User wants raw runtime state (hooks/transients/options) → `wp-introspect`.

## Boundary

Owns:
- Single call to `rolepod_wp_health_check { target_id }`.
- Surfacing the structured output (versions, *_ok flags, warnings).
- Sub-5s budget per call.

Does not own:
- Multi-probe diagnostic sweep (plugin conflicts, slow queries, php errors) → `wp-diagnose`.
- Runtime state snapshot → `wp-introspect`.
- Security audit (outdated/weak users/WP_DEBUG) → `wp-diagnose`.

Return / hand off:
- Any `*_ok: false` with a fixable warning → suggest the fix inline.
- Multiple warnings or unclear cause → hand off to `wp-diagnose`.

## Inputs to gather

- `target_id` — required, must come from a prior connect/pair.

## Workflow

### 1. Call

Single tool call. The output template is in `templates/health-report.md`.

### 2. Interpret

| Flag | Meaning | Fix |
|---|---|---|
| `db_ok: false` | wp-cli probe could not reach DB | check site is up; if companion missing, install for wp-cli-via-companion |
| `rest_ok: false` | REST probe failed | flush permalinks (`Settings → Permalinks → Save`) |
| `wp_cli_ok: false` on RestTarget | companion missing OR `/wp-cli` endpoint disabled | install/upgrade `rolepod-wp` v2.1+ |
| `companion_ok: false` | endpoints disabled OR plugin not active | enable in `Settings → Rolepod for WordPress` |
| `warnings: [...]` | host quirks | report all, fix or defer per item |

### 3. Surface

Fill `templates/health-report.md`. If the user just asked "is it healthy?" — a one-line YES/NO with the failing flag is enough; do not over-format.

## If a matching Rolepod agent is available

- `rolepod:qa-tester` for verification chains across multiple sites.
- `rolepod:devops-sre` for host-side warnings (exec disabled, mod_security, perm rules).

## If no matching agent is available

1. Call `rolepod_wp_health_check`.
2. Surface per `templates/health-report.md`.
3. If any flag false → quote the fix; do not retry automatically.

## Output

Health report — `templates/health-report.md` is the canonical shape. Do not restate inline.

## Examples

No examples file. The decision tree is single-layer (interpret table covers all cases).

## References

Inline only. The 5 flags + warnings are documented in the interpret table above.

## Hard stops

- `target_id` not found → STOP, ask user to re-connect via `wp-connect` or `wp-pair-setup`.
- Health-check itself times out (>30s) → STOP, surface the timeout, do not retry; usually means the host blocked the IP or the site is fully down.

## Full Rolepod enhancement

Full Rolepod adds historical health tracking (per-site `~/.config/rolepod-wplab/memory/<site>/health.jsonl`) so trends across days are visible; standalone, each call is point-in-time.

## Next phase

- All green → continue with the user's intended skill (`wp-content`, `wp-edit-*`, etc.).
- Any flag false → `wp-diagnose` for the full probe, OR the inline fix from the interpret table.
