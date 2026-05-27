import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const RecoveryDisablePluginInputSchema = z.object({
  target_id: z.string(),
  plugin: z
    .string()
    .min(1)
    .describe(
      "Plugin identifier — either the slug ('akismet') or the standard 'slug/main-file.php' form. Guardian resolves via get_plugins().",
    ),
});

export const wpRecoveryDisablePluginToolDef = {
  name: "rolepod_wp_recovery_disable_plugin",
  description:
    "Disable a plugin via the mu-plugin guardian by renaming its main file to <main>.disabled. WP will skip it next request because the file no longer matches the active_plugins entry. Use when a plugin (typically the one you just updated/edited) is causing fatal errors that prevent normal companion calls. After fix, use rolepod_wp_recovery_restore_file to bring it back.",
  inputSchema: RecoveryDisablePluginInputSchema,
};

export async function wpRecoveryDisablePluginHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = RecoveryDisablePluginInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.recoveryDisablePlugin(input.plugin);
}
