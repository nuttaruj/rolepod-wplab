import { z } from "zod";
import { bridgeForRecovery } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryDisableFileInputSchema = z.object({
  target_id: z.string(),
  path: z
    .string()
    .min(1)
    .describe(
      "File path relative to WP root (e.g. 'wp-content/themes/active/functions.php') or absolute. Must resolve under wp-content/{plugins,themes,uploads,mu-plugins} or be wp-config.php.",
    ),
});

export const wpRecoveryDisableFileToolDef = {
  name: "rolepod_wp_recovery_disable_file",
  description:
    "Rename a scoped file to <path>.disabled via the mu-plugin guardian. Use when a specific file (theme functions.php, plugin include, etc.) is causing a fatal but you don't want to disable the entire plugin/theme. WP skips loading the file next request. Reversible via rolepod_wp_recovery_restore_file.",
  inputSchema: RecoveryDisableFileInputSchema,
};

export async function wpRecoveryDisableFileHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryDisableFileInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeForRecovery(target);
  return bridge.recoveryDisableFile(input.path);
}
