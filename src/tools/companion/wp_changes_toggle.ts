import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ChangesToggleInputSchema = z.object({
  target_id: z.string(),
  id: z.number().int().positive(),
  applied: z.boolean(),
});

export const wpChangesToggleToolDef = {
  name: "rolepod_wp_changes_toggle",
  description:
    "Toggle a single AI Change Ledger row applied=true|false. Re-applies the underlying revert/re-apply via the per-category dispatcher in the companion. Side effects vary by category: hook = wrapper flag flip (instant); option = re-write old value; layout = restore postmeta; file = restore .wplab-bak; plugin = (de)activate; theme = switch.",
  inputSchema: ChangesToggleInputSchema,
};

export async function wpChangesToggleHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ChangesToggleInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.toggleChange(input.id, input.applied);
}
