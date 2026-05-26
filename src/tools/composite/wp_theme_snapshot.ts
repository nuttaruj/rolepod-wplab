import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ThemeSnapshotInputSchema = z.object({
  target_id: z.string(),
  stylesheet: z.string().min(1),
});

export const wpThemeSnapshotToolDef = {
  name: "rolepod_wp_theme_snapshot",
  description:
    "Snapshot a theme directory as a .tar.gz at wp-content/uploads/rolepod-wp-theme-snapshots/<slug>-<utc-ts>.tar.gz. Used by wp_theme_switch_safe and by any AI-issued theme edit that needs a known-good rollback artifact. Records a ledger row (category=theme, reversible=true) so the snapshot can be replayed via Change Ledger panic/toggle.",
  inputSchema: ThemeSnapshotInputSchema,
};

export async function wpThemeSnapshotHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ThemeSnapshotInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const result = await bridge.themeSnapshot(input.stylesheet);

  await recordChange(target, {
    category: "theme",
    subcategory: `snapshot:${input.stylesheet}`,
    targetDescriptor: `snapshot theme ${input.stylesheet} → ${result.path}`,
    beforeState: null,
    afterState: {
      stylesheet: input.stylesheet,
      snapshot_path: result.path,
      bytes: result.bytes,
      file_count: result.fileCount,
    },
    reversible: false, // Snapshot itself can't be "un-snapshotted" — file persists on disk.
    sourceTool: "wp_theme_snapshot",
    notes: `archive at ${result.path}`,
  });

  return result;
}
