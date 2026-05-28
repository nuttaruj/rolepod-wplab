/**
 * Recovery auto-chain.
 *
 * When a tool call fails with HTTP 5xx from the companion (the catch-all
 * symptom of "the WP site is dying mid-request"), this helper transparently
 * pulls the guardian's recovery_status snapshot and attaches the lastFatal
 * to the error so the AI sees the actual PHP fatal that caused the 500
 * instead of a generic "HTTP 500" with no context.
 *
 * The original error is preserved — we only enrich its `meta` field. If
 * the guardian itself is unreachable (no rolepod-wp plugin, or guardian
 * dead too), we surface that as a hint instead of swallowing the original.
 */
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { TargetRegistry } from "../target/TargetRegistry.js";

/**
 * Try to extract a target_id from arbitrary tool arguments. Tools accept
 * either `target_id` (typical) or no target id (connect tools). When absent
 * we cannot fetch recovery context — return null.
 */
function extractTargetId(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const t = (args as { target_id?: unknown }).target_id;
  if (typeof t === "string" && t.length > 0) return t;
  return null;
}

/**
 * Return true when the error looks like "companion returned HTTP 5xx".
 * Covers our codes from RestTarget / Bridge / cli_run / file_write.
 */
function isCompanion5xx(err: unknown): err is WplabError {
  if (!(err instanceof WplabError)) return false;
  // Codes follow the pattern <ROOT>_HTTP_<NNN> (e.g. FS_WRITE_HTTP_500,
  // WP_CLI_HTTP_500, GUARDIAN_HTTP_504). Also accept the literal status meta
  // when the code doesn't carry it.
  if (/_HTTP_5\d{2}$/.test(err.code)) return true;
  const status = (err.meta as { status?: unknown } | undefined)?.status;
  return typeof status === "number" && status >= 500 && status < 600;
}

/**
 * Run a tool handler, and if it throws a 5xx companion error, attempt to
 * fetch the recovery status from the guardian and attach the lastFatal to
 * the error before re-throwing.
 *
 * Never throws a different error than the handler did — the guardian probe
 * is best-effort context, not a control-flow change.
 */
export async function withRecoveryContext<T>(
  registry: TargetRegistry,
  toolName: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isCompanion5xx(err)) throw err;

    // Avoid infinite recursion: don't chain on recovery_status itself.
    if (toolName === "rolepod_wp_recovery_status") throw err;

    const targetId = extractTargetId(args);
    if (!targetId) throw err;

    let target;
    try {
      target = registry.get(targetId);
    } catch {
      throw err;
    }

    try {
      const { CompanionBridge } = await import("../companion/Bridge.js");
      const bridge = new CompanionBridge(target);
      const status = await bridge.recoveryStatus();

      const lastFatal = status.lastFatal;
      const newMeta: Record<string, unknown> = {
        ...(err.meta as Record<string, unknown> | undefined),
        recovery_probe: {
          main_alive: status.mainAlive,
          safe_mode: status.safeMode,
          guardian_version: status.guardianVersion,
        },
      };
      if (lastFatal) {
        newMeta["last_fatal"] = lastFatal;
        const enriched = new WplabError(
          err.code,
          `${err.message}\n\nGuardian reports recent fatal:\n  ${(lastFatal as { message?: string }).message ?? "<no message>"}\n  at ${(lastFatal as { file?: string }).file ?? "?"}:${(lastFatal as { line?: number }).line ?? "?"}`,
          newMeta,
        );
        throw enriched;
      } else {
        const enriched = new WplabError(err.code, err.message, newMeta);
        throw enriched;
      }
    } catch (probeErr) {
      // Guardian probe failed too — surface a hint but don't lose the original.
      if (probeErr === err) throw err;
      if (
        probeErr instanceof WplabError &&
        (probeErr.code === "GUARDIAN_NOT_INSTALLED" ||
          probeErr.code.startsWith("GUARDIAN_"))
      ) {
        const newMeta: Record<string, unknown> = {
          ...(err.meta as Record<string, unknown> | undefined),
          recovery_probe_failed: probeErr.code,
        };
        throw new WplabError(
          err.code,
          `${err.message}\n\nGuardian unavailable (${probeErr.code}) — cannot fetch lastFatal context.`,
          newMeta,
        );
      }
      log.debug("recovery probe internal error", {
        tool: toolName,
        err: (probeErr as Error).message,
      });
      throw err;
    }
  }
}
