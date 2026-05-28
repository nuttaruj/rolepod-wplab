import {
  WpCustomTaskListInputSchema,
  WpCustomTaskListOutputSchema,
  type WpCustomTaskListInput,
  type WpCustomTaskListOutput,
} from "../../schema/tools.js";
import { listTasks } from "../../lib/rolepodCustomOps.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomTaskListToolDef = {
  name: "rolepod_wp_custom_task_list",
  description:
    "List every registered task in the Rolepod Custom plugin. Returns id, title, description, enabled state, and module path for each. Read-only; works on production. Returns plugin_installed:false when the plugin hasn't been set up yet — call rolepod_wp_custom_init OR rolepod_wp_custom_task_scaffold (with auto_init) first.",
  inputSchema: WpCustomTaskListInputSchema,
};

export async function wpCustomTaskListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpCustomTaskListOutput> {
  const input: WpCustomTaskListInput = WpCustomTaskListInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const r = await listTasks(target);
  return WpCustomTaskListOutputSchema.parse({
    plugin_installed: r.plugin_installed,
    tasks: r.tasks.map((t) => ({
      task_id: t.taskId,
      title: t.title,
      description: t.description,
      enabled: t.enabled,
      module_path: t.modulePath,
    })),
  });
}
