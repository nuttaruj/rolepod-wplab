import { z } from "zod";
import { bridgeForRecovery } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryStatusInputSchema = z.object({
  target_id: z.string(),
});

export const wpRecoveryStatusToolDef = {
  name: "rolepod_wp_recovery_status",
  description:
    "Probe the mu-plugin guardian on a target. Returns whether the main rolepod-wp plugin is loaded (main_alive), recent FATAL errors caught by the guardian's shutdown handler (recent_fatals, last_fatal), guardian version, and safe-mode flag. Use this when normal companion calls fail with 5xx — if main_alive=false you're in recovery mode and should call rolepod_wp_recovery_disable_file / disable_plugin / restore_snapshot before retrying.",
  inputSchema: RecoveryStatusInputSchema,
};

export async function wpRecoveryStatusHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryStatusInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeForRecovery(target);
  return bridge.recoveryStatus();
}
