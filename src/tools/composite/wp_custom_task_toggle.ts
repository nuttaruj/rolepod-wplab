import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  WpCustomTaskToggleInputSchema,
  WpCustomTaskToggleOutputSchema,
  type WpCustomTaskToggleInput,
  type WpCustomTaskToggleOutput,
} from "../../schema/tools.js";
import {
  isPluginInstalled,
  readTaskEnabled,
  setTaskEnabled,
} from "../../lib/rolepodCustomOps.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomTaskToggleToolDef = {
  name: "rolepod_wp_custom_task_toggle",
  description:
    "Enable or disable a Rolepod Custom task without touching its module file. Writes the `rolepod_custom_<task>_enabled` option — the BaseTask::is_enabled() check that every task's register_hooks() body calls reads from that option, so hooks short-circuit instantly without a code reload.",
  inputSchema: WpCustomTaskToggleInputSchema,
};

export async function wpCustomTaskToggleHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpCustomTaskToggleOutput> {
  const input: WpCustomTaskToggleInput = WpCustomTaskToggleInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  if (!(await isPluginInstalled(target))) {
    throw new WplabError(
      "CUSTOM_PLUGIN_NOT_INSTALLED",
      "Rolepod Custom plugin is not installed.",
      {},
    );
  }
  const previous = await readTaskEnabled(target, input.task_id);
  await setTaskEnabled(target, input.task_id, input.enabled);
  await recordChange(target, {
    category: "option",
    subcategory: `rolepod_custom_${input.task_id.replace(/-/g, "_")}_enabled`,
    targetDescriptor: `toggle task ${input.task_id} → ${input.enabled ? "enabled" : "disabled"}`,
    beforeState: { value: previous ? "1" : "0" },
    afterState: { value: input.enabled ? "1" : "0" },
    reversible: true,
    sourceTool: "wp_custom_task_toggle",
  });
  return WpCustomTaskToggleOutputSchema.parse({
    task_id: input.task_id,
    enabled: input.enabled,
  });
}
