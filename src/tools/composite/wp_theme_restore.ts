import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ThemeRestoreInputSchema = z.object({
  target_id: z.string(),
  snapshot_path: z.string().min(1),
});

export const wpThemeRestoreToolDef = {
  name: "rolepod_wp_theme_restore",
  description:
    "Restore a theme directory from a snapshot created by wp_theme_snapshot. The snapshot_path MUST be inside the managed snapshots dir (the companion refuses out-of-scope paths). Used by wp_theme_switch_safe auto-rollback and by manual recovery flows after a bad theme edit.",
  inputSchema: ThemeRestoreInputSchema,
};

export async function wpThemeRestoreHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ThemeRestoreInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const result = await bridge.themeRestore(input.snapshot_path);

  await recordChange(target, {
    category: "theme",
    subcategory: `restore:${result.stylesheet}`,
    targetDescriptor: `restore theme ${result.stylesheet} from ${input.snapshot_path}`,
    beforeState: null,
    afterState: {
      stylesheet: result.stylesheet,
      files_restored: result.filesRestored,
      from: input.snapshot_path,
    },
    reversible: false, // Restore overwrote files; rollback would need another snapshot.
    sourceTool: "wp_theme_restore",
  });

  return result;
}
