import { z } from "zod";
import { bridgeForRecovery } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryListChangesInputSchema = z.object({
  target_id: z.string(),
  limit: z.number().int().min(1).max(500).default(50),
});

export const wpRecoveryListChangesToolDef = {
  name: "rolepod_wp_recovery_list_changes",
  description:
    "Read recent AI-issued changes from the ledger via the mu-plugin guardian (bypasses the main companion). Use during recovery to identify the last write that may have caused the fatal, then pair with rolepod_wp_recovery_disable_file. DB must be alive — if DB is dead, no recovery path through REST works at all.",
  inputSchema: RecoveryListChangesInputSchema,
};

export async function wpRecoveryListChangesHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryListChangesInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeForRecovery(target);
  return bridge.recoveryListChanges(input.limit);
}
