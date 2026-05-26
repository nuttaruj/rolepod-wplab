import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

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
  const input = ChangesQueryInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const filters: Parameters<typeof bridge.queryChanges>[0] = {};
  if (input.category !== undefined) filters.category = input.category;
  if (input.applied !== undefined) filters.applied = input.applied;
  if (input.since_minutes !== undefined) filters.sinceMinutes = input.since_minutes;
  if (input.source_session !== undefined) filters.sourceSession = input.source_session;
  filters.limit = input.limit;
  return bridge.queryChanges(filters);
}
