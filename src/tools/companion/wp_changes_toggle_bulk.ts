import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ChangesToggleBulkInputSchema = z.object({
  target_id: z.string(),
  ids: z.array(z.number().int().positive()).min(1).max(200),
  applied: z.boolean(),
});

export const wpChangesToggleBulkToolDef = {
  name: "rolepod_wp_changes_toggle_bulk",
  description:
    "Bulk-toggle N AI Change Ledger rows in one call. Each row runs through its category dispatcher independently. Returns per-id success result. Useful for git-bisect-style narrowing after a broken site is recovered: re-enable batches, find the bad one.",
  inputSchema: ChangesToggleBulkInputSchema,
};

export async function wpChangesToggleBulkHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ChangesToggleBulkInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.toggleChangesBulk(input.ids, input.applied);
}
