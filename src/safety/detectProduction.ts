import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";
import type { ProdGuard } from "./ProdGuard.js";

/**
 * Read the RAW environment signal, not `wp_get_environment_type()`.
 *
 * WordPress returns `'production'` from `wp_get_environment_type()` when
 * nothing is configured, so trusting it would arm the guard on every
 * unconfigured local box. An unset signal must leave the guard disarmed.
 */
const RAW_ENV_TYPE_PHP =
  "echo getenv('WP_ENVIRONMENT_TYPE') ?: (defined('WP_ENVIRONMENT_TYPE') ? constant('WP_ENVIRONMENT_TYPE') : '');";

export type ProdGuardReason =
  /** the site declared WP_ENVIRONMENT_TYPE=production */
  | "env_type"
  /** siteurl matched ROLEPOD_WPLAB_PROD_HOSTS */
  | "host_pattern"
  /** the companion reported is_production at pair time (pre-2.24 companions) */
  | "companion"
  /** the companion reported guarded mode — full-access toggle OFF */
  | "guarded"
  /** the owner enabled full access on the companion; guard deliberately off */
  | "full_access"
  /** the signal is set to something other than production */
  | "not_production"
  /** the signal is unset — guard stays disarmed */
  | "unset"
  /** the probe could not run (no wp-cli reachable) — guard stays disarmed */
  | "probe_failed";

export interface ProdGuardStatus {
  /** raw signal; `""` when unset, `null` when the probe failed */
  env_type: string | null;
  armed: boolean;
  reason: ProdGuardReason;
}

/**
 * Probe the target's environment type and arm `prodGuard` when it says
 * production. Never throws: a target we cannot probe is reported disarmed
 * with `reason: "probe_failed"` rather than blocking the connect.
 */
export async function armProdGuard(
  target: Target,
  prodGuard: ProdGuard,
): Promise<ProdGuardStatus> {
  const envType = await probeRawEnvType(target);

  if (envType === "production") prodGuard.markProduction(target.siteurl);
  const armed = prodGuard.isArmedFor(target.siteurl);

  return { env_type: envType, armed, reason: reasonFor(envType, armed) };
}

function reasonFor(envType: string | null, armed: boolean): ProdGuardReason {
  if (envType === "production") return "env_type";
  if (armed) return "host_pattern";
  if (envType === null) return "probe_failed";
  if (envType === "") return "unset";
  return "not_production";
}

async function probeRawEnvType(target: Target): Promise<string | null> {
  try {
    const result = await target.wpCli(["eval", RAW_ENV_TYPE_PHP], {
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0) return null;
    return result.stdout.trim();
  } catch (err) {
    log.debug("prod-guard env probe failed", {
      id: target.id,
      err: (err as Error).message,
    });
    return null;
  }
}
