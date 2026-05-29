import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import {
  detectRolepodParent,
  resolveEvidenceDir,
  writeManifest,
  makeRunTimestamp,
} from "../../lib/rolepodEvidence.js";

export const ChangesQueryInputSchema = z.object({
  target_id: z.string(),
  category: z.string().optional(),
  applied: z.boolean().optional(),
  since_minutes: z.number().int().positive().max(1440).optional(),
  source_session: z.string().optional(),
  limit: z.number().int().positive().max(500).default(100),
});

export type ChangesQueryInput = z.infer<typeof ChangesQueryInputSchema>;

export const wpChangesQueryToolDef = {
  name: "rolepod_wp_changes_query",
  description:
    "Query the AI Change Ledger on the target. Lists every change the MCP recorded via the companion (v2.3+) — categorized, with applied flag and reversible flag. Filters: category, applied, since_minutes (last N minutes), source_session.",
  inputSchema: ChangesQueryInputSchema,
};

export async function wpChangesQueryHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const startedAt = new Date();
  const input = ChangesQueryInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const filters: Parameters<typeof bridge.queryChanges>[0] = {};
  if (input.category !== undefined) filters.category = input.category;
  if (input.applied !== undefined) filters.applied = input.applied;
  if (input.since_minutes !== undefined)
    filters.sinceMinutes = input.since_minutes;
  if (input.source_session !== undefined)
    filters.sourceSession = input.source_session;
  filters.limit = input.limit;
  const result = await bridge.queryChanges(filters);

  // Rolepod Extension Protocol v1: when the parent plugin's marker file is
  // present, write a `manifest.json` to the parent's evidence dir so its
  // `review-code` orchestrator can aggregate review-phase results.
  const parent = detectRolepodParent();
  if (parent.active) {
    try {
      const rows = extractRows(result);
      const reversibleCount = rows.filter(
        (r) => r.reversible === true || r.reversible === 1,
      ).length;
      const nonReversibleCount = rows.length - reversibleCount;
      const status: "pass" | "warn" | "fail" =
        nonReversibleCount > 0 ? "warn" : "pass";

      const ts = makeRunTimestamp();
      const { dir } = resolveEvidenceDir("wp-changes", ts);
      writeFileSync(join(dir, "diff.json"), JSON.stringify(result, null, 2));
      writeManifest(dir, {
        skill: "wp-changes",
        phase: "review",
        status,
        summary: `${rows.length} change(s) — ${reversibleCount} reversible, ${nonReversibleCount} non-reversible`,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        artifacts: [{ type: "diff", path: "./diff.json" }],
        metadata: {
          target_id: input.target_id,
          filters: {
            category: input.category ?? null,
            applied: input.applied ?? null,
            since_minutes: input.since_minutes ?? null,
            source_session: input.source_session ?? null,
            limit: input.limit,
          },
          row_count: rows.length,
          reversible_count: reversibleCount,
          non_reversible_count: nonReversibleCount,
        },
      });
    } catch (err) {
      // Evidence emission failure must NOT break the tool's primary contract.
      // eslint-disable-next-line no-console
      console.warn(
        `wp-changes: failed to write rolepod evidence: ${(err as Error).message}`,
      );
    }
  }

  return result;
}

/**
 * Best-effort row extraction from whatever `bridge.queryChanges` returns.
 * Supports both `{ rows: [...] }` and bare array shapes so we don't break
 * if the bridge response shape changes.
 */
function extractRows(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object") {
    const obj = result as { rows?: unknown };
    if (Array.isArray(obj.rows)) {
      return obj.rows as Array<Record<string, unknown>>;
    }
  }
  return [];
}
