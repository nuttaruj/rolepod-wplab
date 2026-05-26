import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";

/**
 * Best-effort cache flush. Used after design-layer writes (theme.json,
 * global-styles) so the Site Editor sees the new state on next reload.
 *
 * Non-fatal: if wp-cli is unavailable on the target (no companion,
 * shell-only kinds with no wp-cli, etc.), we log debug and continue.
 * The user's write has already succeeded; cache staleness is a UX
 * inconvenience, not a correctness failure.
 */
export async function flushObjectCache(target: Target): Promise<void> {
  try {
    const r = await target.wpCli(["cache", "flush"], { allowDestructive: true });
    if (r.exitCode !== 0) {
      log.debug("auto cache flush: non-zero exit (continuing)", {
        exitCode: r.exitCode,
        stderr: r.stderr.slice(0, 200),
      });
    }
  } catch (err) {
    log.debug("auto cache flush skipped", {
      reason: (err as Error).message,
    });
  }
}
