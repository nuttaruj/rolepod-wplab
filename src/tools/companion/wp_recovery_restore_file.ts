import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryRestoreFileInputSchema = z.object({
  target_id: z.string(),
  path: z
    .string()
    .min(1)
    .describe(
      "Either the .disabled form or the active form — guardian normalizes. Renames <path>.disabled back to <path>.",
    ),
});

export const wpRecoveryRestoreFileToolDef = {
  name: "rolepod_wp_recovery_restore_file",
  description:
    "Reverse rolepod_wp_recovery_disable_file (or the regular wp_file_disable) via the mu-plugin guardian. Refuses if the .disabled file is missing or if the active form already exists. Use after fixing the underlying cause to re-enable the file.",
  inputSchema: RecoveryRestoreFileInputSchema,
};

export async function wpRecoveryRestoreFileHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryRestoreFileInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.recoveryRestoreFile(input.path);
}
