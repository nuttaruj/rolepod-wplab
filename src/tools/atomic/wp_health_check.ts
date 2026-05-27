import {
  WpHealthCheckInputSchema,
  WpHealthCheckOutputSchema,
  type WpHealthCheckInput,
  type WpHealthCheckOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

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

  return WpHealthCheckOutputSchema.parse({
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
}
