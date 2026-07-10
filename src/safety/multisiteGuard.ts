import { WplabError } from "../util/errors.js";
import type { Target } from "../runtime/Target.js";

/**
 * Refuse to run on a multisite network.
 *
 * `wp core is-installed --network` produces no output and communicates through
 * its exit code: 0 when this is a multisite install, non-zero otherwise. (There
 * is no `wp core is-multisite` — wp-cli rejects it as an unregistered
 * subcommand.)
 *
 * A probe that cannot run fails CLOSED: on a network we could not identify,
 * a tool that rewrites site-wide state is more dangerous than a tool that
 * refuses to start.
 */
export async function assertSingleSite(target: Target): Promise<void> {
  let exitCode: number;
  try {
    const result = await target.wpCli(["core", "is-installed", "--network"], {
      timeoutMs: 15_000,
    });
    exitCode = result.exitCode;
  } catch (err) {
    throw new WplabError(
      "MULTISITE_PROBE_FAILED",
      `Could not determine whether ${target.siteurl} is a multisite network, and this tool is unsafe on one. Probe error: ${(err as Error).message}`,
      { siteurl: target.siteurl, target_id: target.id },
    );
  }

  if (exitCode === 0) {
    throw new WplabError(
      "MULTISITE_UNSUPPORTED",
      `${target.siteurl} is a WordPress multisite network. This tool writes site-wide state and has not been validated against multisite — refusing to run. Operate on the single site directly, or perform this change by hand.`,
      { siteurl: target.siteurl, target_id: target.id },
    );
  }
}
