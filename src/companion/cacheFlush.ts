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
    const r = await target.wpCli(["cache", "flush"], {
      allowDestructive: true,
    });
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

/**
 * Best-effort Elementor CSS-cache flush. Run after ANY `_elementor_data`
 * write — Elementor caches a per-post CSS file keyed to the widget tree, and a
 * direct meta edit leaves that file stale, so the front-end renders the OLD
 * layout until the cache regenerates. Forgetting this is the exact trap that
 * made Phase-8 verification read a stale page as "fine".
 *
 * Non-fatal: `wp elementor flush-css` only exists when Elementor is active and
 * wp-cli is reachable. If either is missing we log debug and continue — the
 * write already succeeded; a stale CSS cache is a UX inconvenience, not a
 * correctness failure (the editor regenerates it on next save/visit anyway).
 */
export async function flushElementorCss(target: Target): Promise<void> {
  try {
    const r = await target.wpCli(["elementor", "flush-css"], {
      allowDestructive: true,
    });
    if (r.exitCode !== 0) {
      log.debug("auto elementor flush-css: non-zero exit (continuing)", {
        exitCode: r.exitCode,
        stderr: r.stderr.slice(0, 200),
      });
    }
  } catch (err) {
    log.debug("auto elementor flush-css skipped", {
      reason: (err as Error).message,
    });
  }
}
