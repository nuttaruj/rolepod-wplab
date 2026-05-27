import { z } from "zod";
import { bridgeForRecovery } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryRestoreSnapshotInputSchema = z.object({
  target_id: z.string(),
  snapshot_path: z
    .string()
    .min(1)
    .describe(
      "Absolute path to a .tar.gz snapshot under wp-content/uploads/rolepod-wp-theme-snapshots/. Derived from a prior rolepod_wp_theme_snapshot call.",
    ),
});

export const wpRecoveryRestoreSnapshotToolDef = {
  name: "rolepod_wp_recovery_restore_snapshot",
  description:
    "Untar a previously-captured theme snapshot via the mu-plugin guardian. Useful when the active theme is broken and the main companion can't run rolepod_wp_theme_restore (because main plugin is down). Path is scope-checked against the managed snapshots dir.",
  inputSchema: RecoveryRestoreSnapshotInputSchema,
};

export async function wpRecoveryRestoreSnapshotHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryRestoreSnapshotInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeForRecovery(target);
  return bridge.recoveryRestoreSnapshot(input.snapshot_path);
}
