import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ChangesPanicInputSchema = z.object({
  target_id: z.string(),
  since_minutes: z.number().int().positive().max(1440),
});

export const wpChangesPanicToolDef = {
  name: "rolepod_wp_changes_panic",
  description:
    "PANIC button — disable every AI-issued change recorded in the last N minutes on the target. Reverts the underlying side effects via the per-category dispatcher in the companion. Use when the site broke after AI activity and you want the fastest possible rollback. After site recovers, use changes_toggle_bulk to re-enable batches and bisect the bad change.",
  inputSchema: ChangesPanicInputSchema,
};

export async function wpChangesPanicHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ChangesPanicInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.panicChanges(input.since_minutes);
}
