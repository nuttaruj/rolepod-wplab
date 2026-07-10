import { z } from "zod";
import { bridgeForRecovery } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoverySafeModeInputSchema = z.object({
  target_id: z.string(),
  enabled: z.boolean(),
});

export const wpRecoverySafeModeToolDef = {
  name: "rolepod_wp_recovery_safe_mode",
  description:
    "Toggle the safe-mode flag on the target. WARNING — on the currently released companion this flag is ADVISORY for most operations: only media optimization honours it. execute-php, fs-write, fs-write-batch and wp-cli still run with safe-mode ON. Treat it as a signal to yourself to stop writing after a fatal, not as an enforced lock. Admins can also toggle it from Settings → Rolepod for WordPress.",
  inputSchema: RecoverySafeModeInputSchema,
};

export async function wpRecoverySafeModeHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoverySafeModeInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeForRecovery(target);
  return bridge.recoverySafeMode(input.enabled);
}
