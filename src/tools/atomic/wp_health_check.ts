import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  WpHealthCheckInputSchema,
  WpHealthCheckOutputSchema,
  type WpHealthCheckInput,
  type WpHealthCheckOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import {
  detectRolepodParent,
  resolveEvidenceDir,
  writeManifest,
  makeRunTimestamp,
} from "../../lib/rolepodEvidence.js";

export const wpHealthCheckToolDef = {
  name: "rolepod_wp_health_check",
  description:
    "Lightweight diagnostic of a connected WP target — versions, wp-cli reachability, REST reachability, companion presence, warnings.",
  inputSchema: WpHealthCheckInputSchema,
};

export async function wpHealthCheckHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpHealthCheckOutput> {
  const startedAt = new Date();
  const input: WpHealthCheckInput = WpHealthCheckInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const warnings: string[] = [];

  // wp-cli reachability — works on every target kind:
  //   LocalTarget/SshTarget/DockerTarget → spawn `wp` binary directly.
  //   RestTarget → routes through companion `/wp-cli` endpoint via bridge.
  let wpCliOk = false;
  try {
    const result = await target.wpCli(["cli", "version"]);
    wpCliOk = result.exitCode === 0;
  } catch (err) {
    warnings.push(`wp-cli check failed: ${(err as Error).message}`);
  }

  // DB check via wp-cli `option get siteurl` — PHP-only (mysqli), no system
  // mysql client binary required. If it returns 0 and a non-empty value, DB
  // is reachable.
  let dbOk = false;
  try {
    const result = await target.wpCli(["option", "get", "siteurl"]);
    dbOk = result.exitCode === 0 && result.stdout.trim().length > 0;
    if (!dbOk) {
      warnings.push(
        `db probe exit ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
      );
    }
  } catch (err) {
    warnings.push(`db probe failed: ${(err as Error).message}`);
  }

  // REST reachability — issue a tiny HEAD-ish probe via target.rest() if
  // available. RestTarget always has rest(); LocalTarget/SshTarget/DockerTarget
  // don't (their reachability is wp-cli-based, captured above).
  let restOk = false;
  if ("rest" in target && typeof (target as { rest?: unknown }).rest === "function") {
    try {
      const res = await (target as { rest: (req: { method: string; path: string }) => Promise<{ status: number }> }).rest({
        method: "GET",
        path: "/wp/v2/types/post",
      });
      restOk = res.status >= 200 && res.status < 400;
      if (!restOk) {
        warnings.push(`REST probe returned HTTP ${res.status}`);
      }
    } catch (err) {
      warnings.push(`REST probe failed: ${(err as Error).message}`);
    }
  }

  const companionOk = target.companion?.enabled === true;

  const output = WpHealthCheckOutputSchema.parse({
    wp_version: target.wpVersion,
    ...(target.phpVersion !== undefined
      ? { php_version: target.phpVersion }
      : {}),
    db_ok: dbOk,
    wp_cli_ok: wpCliOk,
    rest_ok: restOk,
    companion_ok: companionOk,
    site_url: target.siteurl,
    warnings,
  });

  // Rolepod Extension Protocol v1: when the parent plugin's marker file is
  // present, write a `manifest.json` to the parent's evidence dir so its
  // `check-work` orchestrator can aggregate verify-phase results.
  const parent = detectRolepodParent();
  if (parent.active) {
    try {
      const ts = makeRunTimestamp();
      const { dir } = resolveEvidenceDir("wp-health-check", ts);
      const status: "pass" | "warn" | "fail" =
        !output.db_ok || !output.wp_cli_ok
          ? "fail"
          : output.warnings.length > 0
            ? "warn"
            : "pass";
      writeFileSync(
        join(dir, "health.json"),
        JSON.stringify(output, null, 2),
      );
      writeManifest(dir, {
        skill: "wp-health-check",
        phase: "verify",
        status,
        summary: `WP ${output.wp_version}, PHP ${output.php_version ?? "unknown"}, ${output.warnings.length} warning(s)`,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        artifacts: [{ type: "report", path: "./health.json" }],
        metadata: {
          wp_version: output.wp_version,
          php_version: output.php_version ?? null,
          db_ok: output.db_ok,
          wp_cli_ok: output.wp_cli_ok,
          rest_ok: output.rest_ok,
          companion_ok: output.companion_ok,
          site_url: output.site_url,
        },
      });
    } catch (err) {
      // Evidence emission failure must NOT break the tool's primary contract.
      // Surface as a warning but return the health result unchanged.
      // eslint-disable-next-line no-console
      console.warn(
        `wp-health-check: failed to write rolepod evidence: ${(err as Error).message}`,
      );
    }
  }

  return output;
}
