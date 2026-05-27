import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { bridgeFor } from "../../companion/Bridge.js";
import {
  DiagnoseInputSchema,
  DiagnoseOutputSchema,
  type DiagnoseInput,
  type DiagnoseOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpDiagnoseToolDef = {
  name: "rolepod_wp_diagnose",
  description:
    "Run a non-destructive diagnostic sweep: plugin_conflict_probe (count active plugins + version drift), slow_queries (largest wp_options rows + biggest postmeta), large_options (top 10 autoload=yes rows), broken_images (sample wp_posts srcs that 404), php_errors (tail debug.log). All scopes read-only. Findings ranked info/warn/critical.",
  inputSchema: DiagnoseInputSchema,
};

interface Finding {
  scope: string;
  severity: "info" | "warn" | "critical";
  message: string;
  detail?: unknown;
}

export async function wpDiagnoseHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<DiagnoseOutput> {
  const input: DiagnoseInput = DiagnoseInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  // No kind gate — RestTarget now routes wpCli through the companion's
  // /wp-cli endpoint (v1.4). If the companion is missing on a RestTarget,
  // wpCli() itself surfaces CompanionUnavailableError with install URL.

  const findings: Finding[] = [];

  for (const scope of input.scopes) {
    if (scope === "plugin_conflict_probe") {
      findings.push(...(await pluginConflictProbe(target)));
    } else if (scope === "slow_queries") {
      findings.push(...(await slowQueriesProbe(target)));
    } else if (scope === "large_options") {
      findings.push(...(await largeOptionsProbe(target)));
    } else if (scope === "broken_images") {
      findings.push(...(await brokenImagesProbe(target)));
    } else if (scope === "php_errors") {
      findings.push(...(await phpErrorsProbe(target)));
    }
  }

  const runId = makeRunId();
  const artifactDir = join(process.cwd(), ".rolepod-wplab", "artifacts", runId);
  await mkdir(artifactDir, { recursive: true });
  const reportPath = join(
    artifactDir,
    `diagnose-report.${input.report_format === "json" ? "json" : "md"}`,
  );
  await writeFile(
    reportPath,
    formatReport(findings, input.report_format),
    "utf8",
  );

  return DiagnoseOutputSchema.parse({
    run_id: runId,
    findings,
    report_path: reportPath,
  });
}

async function pluginConflictProbe(target: Target): Promise<Finding[]> {
  const r = await target.wpCli([
    "plugin",
    "list",
    "--format=json",
    "--status=active",
  ]);
  if (r.exitCode !== 0) {
    return [
      {
        scope: "plugin_conflict_probe",
        severity: "warn",
        message: "plugin list failed",
        detail: r.stderr.slice(0, 200),
      },
    ];
  }
  let rows: Array<{ name: string; version: string; update?: string }> = [];
  try {
    rows = JSON.parse(r.stdout || "[]");
  } catch {
    rows = [];
  }
  const findings: Finding[] = [
    {
      scope: "plugin_conflict_probe",
      severity: rows.length > 25 ? "warn" : "info",
      message: `${rows.length} active plugins (${rows.length > 25 ? "consider audit for conflict risk" : "within reasonable count"})`,
    },
  ];
  const stale = rows.filter((p) => p.update === "available");
  if (stale.length > 0) {
    findings.push({
      scope: "plugin_conflict_probe",
      severity: stale.length > 5 ? "critical" : "warn",
      message: `${stale.length} plugins have pending updates`,
      detail: stale.map((p) => p.name),
    });
  }
  return findings;
}

async function slowQueriesProbe(target: Target): Promise<Finding[]> {
  // Use companion /db-query when available (RestTarget + companion) so the
  // {prefix} placeholder gets substituted server-side via $wpdb->prefix and
  // shell escapes don't bite. Falls back to wp-cli `db query` for
  // shell-capable targets without companion. v2.7.0's MCP retest exposed
  // that wp-cli does NOT substitute {prefix} — the literal string went
  // straight to mysql and got "Unknown table" errors.
  if (target.kind === "rest" && target.companion?.enabled) {
    try {
      const bridge = await bridgeFor(target);
      const result = await bridge.dbQuery(
        "SELECT meta_key, COUNT(*) AS rows_n, ROUND(AVG(LENGTH(meta_value))) AS avg_bytes FROM {prefix}postmeta GROUP BY meta_key ORDER BY avg_bytes DESC LIMIT 10",
      );
      return [
        {
          scope: "slow_queries",
          severity: "info",
          message: "top postmeta keys by avg row size",
          detail: result.rows,
        },
      ];
    } catch (err) {
      return [
        {
          scope: "slow_queries",
          severity: "warn",
          message: "postmeta size query failed",
          detail: (err as Error).message.slice(0, 200),
        },
      ];
    }
  }

  const r = await target.wpCli([
    "db",
    "query",
    "SELECT meta_key, COUNT(*) AS rows_n, ROUND(AVG(LENGTH(meta_value))) AS avg_bytes FROM " +
      "{prefix}postmeta GROUP BY meta_key ORDER BY avg_bytes DESC LIMIT 10",
    "--skip-column-names",
  ]);
  if (r.exitCode !== 0) {
    return [
      {
        scope: "slow_queries",
        severity: "warn",
        message: "postmeta size query failed",
        detail: r.stderr.slice(0, 200),
      },
    ];
  }
  const rows = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  return [
    {
      scope: "slow_queries",
      severity: "info",
      message: `top postmeta keys by avg row size (TSV: meta_key\\trows\\tavg_bytes)`,
      detail: rows,
    },
  ];
}

async function largeOptionsProbe(target: Target): Promise<Finding[]> {
  // Same pattern as slowQueriesProbe — prefer companion /db-query.
  if (target.kind === "rest" && target.companion?.enabled) {
    try {
      const bridge = await bridgeFor(target);
      const result = await bridge.dbQuery(
        "SELECT option_name, LENGTH(option_value) AS bytes FROM {prefix}options WHERE autoload IN ('yes','on','auto') ORDER BY bytes DESC LIMIT 10",
      );
      const findings: Finding[] = [];
      for (const row of result.rows) {
        const name = String(row["option_name"] ?? "");
        const bytes = Number(row["bytes"] ?? 0);
        if (!name) continue;
        if (bytes > 1_000_000) {
          findings.push({
            scope: "large_options",
            severity: "critical",
            message: `autoload option ${name} is ${(bytes / 1024 / 1024).toFixed(2)} MB — slows every page load`,
          });
        } else if (bytes > 200_000) {
          findings.push({
            scope: "large_options",
            severity: "warn",
            message: `autoload option ${name} is ${(bytes / 1024).toFixed(1)} KB — consider non-autoload`,
          });
        }
      }
      if (findings.length === 0) {
        findings.push({
          scope: "large_options",
          severity: "info",
          message: `no autoload options >200KB (scanned ${result.count} rows)`,
        });
      }
      return findings;
    } catch (err) {
      return [
        {
          scope: "large_options",
          severity: "warn",
          message: "options query failed",
          detail: (err as Error).message.slice(0, 200),
        },
      ];
    }
  }

  const r = await target.wpCli([
    "db",
    "query",
    "SELECT option_name, LENGTH(option_value) AS bytes FROM {prefix}options WHERE autoload IN ('yes','on','auto') ORDER BY bytes DESC LIMIT 10",
    "--skip-column-names",
  ]);
  if (r.exitCode !== 0) {
    return [
      {
        scope: "large_options",
        severity: "warn",
        message: "options query failed",
        detail: r.stderr.slice(0, 200),
      },
    ];
  }
  const rows = r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const findings: Finding[] = [];
  for (const row of rows) {
    const parts = row.split(/\s+/);
    const name = parts[0];
    const bytes = Number.parseInt(parts[1] ?? "0", 10);
    if (!name) continue;
    if (bytes > 1_000_000) {
      findings.push({
        scope: "large_options",
        severity: "critical",
        message: `autoload option ${name} is ${(bytes / 1024 / 1024).toFixed(2)} MB — slows every page load`,
      });
    } else if (bytes > 200_000) {
      findings.push({
        scope: "large_options",
        severity: "warn",
        message: `autoload option ${name} is ${(bytes / 1024).toFixed(1)} KB — consider non-autoload`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      scope: "large_options",
      severity: "info",
      message: "no autoload options > 200 KB",
    });
  }
  return findings;
}

async function brokenImagesProbe(target: Target): Promise<Finding[]> {
  // Prefer companion /db-query for RestTarget+companion (avoids the
  // shell-escape hazards of the SQL embedded in wp-cli `db query` —
  // single-quote literals + LIKE patterns + SUBSTRING_INDEX delimiters).
  // Falls back to wp-cli for shell-capable targets without companion.
  const sql =
    "SELECT DISTINCT SUBSTRING_INDEX(SUBSTRING_INDEX(post_content, '<img', -1), 'src=\"', -1) AS src FROM {prefix}posts WHERE post_status = 'publish' AND post_content LIKE '%<img%' LIMIT 50";
  if (target.kind === "rest" && target.companion?.enabled) {
    try {
      const bridge = await bridgeFor(target);
      const result = await bridge.dbQuery(sql);
      const samples = result.rows.map((r) => String(r["src"] ?? "")).filter(Boolean).slice(0, 5);
      return [
        {
          scope: "broken_images",
          severity: "info",
          message: `image src sample (${result.count} scanned, showing up to 5)`,
          detail: samples,
        },
      ];
    } catch (err) {
      return [
        {
          scope: "broken_images",
          severity: "warn",
          message: "image scan failed",
          detail: (err as Error).message.slice(0, 200),
        },
      ];
    }
  }

  const r = await target.wpCli([
    "db",
    "query",
    sql,
    "--skip-column-names",
  ]);
  if (r.exitCode !== 0) {
    return [
      {
        scope: "broken_images",
        severity: "info",
        message: "image scan deferred (db query unsupported)",
      },
    ];
  }
  const sample = r.stdout.split("\n").slice(0, 5);
  return [
    {
      scope: "broken_images",
      severity: "info",
      message:
        "image src sample (v1.1 returns sample only; v1.2 will HEAD-probe each)",
      detail: sample,
    },
  ];
}

async function phpErrorsProbe(target: Target): Promise<Finding[]> {
  try {
    const tail = await target.fileRead("wp-content/debug.log");
    const lines = tail.content.split("\n").slice(-50);
    const errors = lines.filter((l) =>
      /PHP\s+(Fatal|Warning|Error|Notice)/i.test(l),
    );
    if (errors.length === 0) {
      return [
        {
          scope: "php_errors",
          severity: "info",
          message: "debug.log tail has no PHP errors in last 50 lines",
        },
      ];
    }
    return [
      {
        scope: "php_errors",
        severity: errors.some((l) => /Fatal/i.test(l)) ? "critical" : "warn",
        message: `${errors.length} PHP error lines in last 50 of debug.log`,
        detail: errors.slice(-10),
      },
    ];
  } catch {
    return [
      {
        scope: "php_errors",
        severity: "info",
        message:
          "no wp-content/debug.log (WP_DEBUG_LOG not enabled or no errors yet)",
      },
    ];
  }
}

function formatReport(findings: Finding[], fmt: "markdown" | "json"): string {
  if (fmt === "json") return JSON.stringify({ findings }, null, 2);
  const lines = ["# rolepod-wplab diagnose report", ""];
  const bySeverity = {
    critical: [] as Finding[],
    warn: [] as Finding[],
    info: [] as Finding[],
  };
  for (const f of findings) bySeverity[f.severity].push(f);
  for (const sev of ["critical", "warn", "info"] as const) {
    if (bySeverity[sev].length === 0) continue;
    lines.push(`## ${sev.toUpperCase()} (${bySeverity[sev].length})`, "");
    for (const f of bySeverity[sev]) {
      lines.push(`- **${f.scope}** — ${f.message}`);
      if (f.detail !== undefined) {
        lines.push("  ```");
        lines.push(
          "  " + JSON.stringify(f.detail, null, 2).split("\n").join("\n  "),
        );
        lines.push("  ```");
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}
