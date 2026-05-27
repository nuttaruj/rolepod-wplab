import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoverySafeModeInputSchema = z.object({
  target_id: z.string(),
  enabled: z.boolean(),
});

export const wpRecoverySafeModeToolDef = {
  name: "rolepod_wp_recovery_safe_mode",
  description:
    "Toggle the safe-mode flag on the target. When ON, the main companion (when alive) should refuse risky ops — execute-php, theme switch, file write to functions.php/wp-config. Use after a fatal to prevent the AI from immediately re-introducing the bad write. Admins can also toggle this from Settings → Rolepod for WordPress.",
  inputSchema: RecoverySafeModeInputSchema,
};

export async function wpRecoverySafeModeHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoverySafeModeInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.recoverySafeMode(input.enabled);
}
