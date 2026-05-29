import { bridgeFor } from "./Bridge.js";
import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";

/**
 * Helper for writer tools to auto-record a change into the v2.3+ companion
 * Change Ledger. Each writer tool calls `recordChange` right after a
 * successful write — capturing before+after state so the user can revert
 * via the admin UI or the `rolepod_wp_changes_*` MCP tools.
 *
 * Failure is non-fatal: if the companion is missing, endpoints disabled,
 * or the ledger table is not present (companion < v2.3), the helper logs
 * a debug line and returns null. The actual write the user asked for has
 * already happened — we never fail the user-visible op because the audit
 * trail failed.
 *
 * Env override:
 *   ROLEPOD_WPLAB_LEDGER=off → skip recording entirely (testing or
 *   privacy-restricted deployments).
 *   ROLEPOD_WPLAB_LEDGER=on (default in v1.6+) → record.
 */
export interface ChangeRecord {
  category:
    | "hook"
    | "option"
    | "post"
    | "layout"
    | "file"
    | "plugin"
    | "theme"
    | "execute_php";
  subcategory: string;
  targetDescriptor: string;
  beforeState?: unknown;
  afterState?: unknown;
  reversible?: boolean;
  sourceTool: string;
  sourceSession?: string;
  notes?: string;
}

export async function recordChange(
  target: Target,
  record: ChangeRecord,
): Promise<{ auditId: string } | null> {
  const env = process.env["ROLEPOD_WPLAB_LEDGER"];
  if (env === "off" || env === "0" || env === "false") {
    return null;
  }

  if (target.kind !== "rest") {
    // Ledger is companion-only; non-rest kinds bypass.
    return null;
  }

  // Auto-fill source_session from env if the caller didn't pass one.
  // `wp_session_start` sets ROLEPOD_WPLAB_SESSION so all subsequent writes
  // in the same MCP process get grouped without per-call wiring.
  const envSession = process.env["ROLEPOD_WPLAB_SESSION"];
  if (record.sourceSession === undefined && envSession) {
    record = { ...record, sourceSession: envSession };
  }

  try {
    const bridge = await bridgeFor(target);
    return await bridge.recordChange(record);
  } catch (err) {
    const e = err as Error & { code?: string };
    log.debug("ledger record skipped", {
      tool: record.sourceTool,
      category: record.category,
      reason: e.message ?? "unknown",
      code: e.code ?? null,
    });
    return null;
  }
}
