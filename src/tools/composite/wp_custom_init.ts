import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  WpCustomInitInputSchema,
  WpCustomInitOutputSchema,
  type WpCustomInitInput,
  type WpCustomInitOutput,
} from "../../schema/tools.js";
import {
  installPluginSkeleton,
  isPluginInstalled,
} from "../../lib/rolepodCustomOps.js";
import { ROLEPOD_CUSTOM_PLUGIN_DIR } from "../../lib/rolepodCustomTemplates.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomInitToolDef = {
  name: "rolepod_wp_custom_init",
  description:
    "Lazy-install the Rolepod Custom plugin on a target site. Writes the plugin skeleton (rolepod-custom.php + inc/ Plugin/TaskRegistry/BaseTask/AdminMenu + assets/admin.css + uninstall.php + readme.txt) via fs-write-batch (atomic), then activates it. Idempotent — returns was_already_installed: true when the main file is present. Pre-requisite for `rolepod_wp_custom_task_scaffold` (which auto-runs init by default).",
  inputSchema: WpCustomInitInputSchema,
};

export async function wpCustomInitHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpCustomInitOutput> {
  const input: WpCustomInitInput = WpCustomInitInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const install = await installPluginSkeleton(target);

  let activated = false;
  if (input.activate && !(await isPluginAlreadyActive(target))) {
    const r = await target.wpCli(["plugin", "activate", "rolepod-custom"], {
      allowDestructive: true,
      timeoutMs: 30_000,
    });
    activated = r.exitCode === 0;
  } else if (input.activate) {
    activated = true;
  }

  return WpCustomInitOutputSchema.parse({
    plugin_dir: ROLEPOD_CUSTOM_PLUGIN_DIR,
    files_written: install.files_written,
    was_already_installed: install.was_already_installed,
    activated,
  });
}

async function isPluginAlreadyActive(
  target: import("../../runtime/Target.js").Target,
): Promise<boolean> {
  try {
    const r = await target.wpCli(["plugin", "is-active", "rolepod-custom"], {
      allowDestructive: false,
      timeoutMs: 10_000,
    });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}
