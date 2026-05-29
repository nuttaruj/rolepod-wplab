import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import {
  WpCustomTaskScaffoldInputSchema,
  WpCustomTaskScaffoldOutputSchema,
  type WpCustomTaskScaffoldInput,
  type WpCustomTaskScaffoldOutput,
} from "../../schema/tools.js";
import {
  buildTaskModulePhp,
  installPluginSkeleton,
  isPluginInstalled,
  modulePathFor,
} from "../../lib/rolepodCustomOps.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomTaskScaffoldToolDef = {
  name: "rolepod_wp_custom_task_scaffold",
  description:
    "Scaffold a new task into the Rolepod Custom plugin. Writes `inc/Modules/<PascalCase>Task.php` extending BaseTask. Auto-installs the plugin via `rolepod_wp_custom_init` if missing (controlled by auto_init, default true). The task auto-appears as a submenu under 'Rolepod Custom' on next page load — TaskRegistry discovers modules via glob. Refuses if a task with the same id already exists (use rolepod_wp_custom_task_update to modify in place).",
  inputSchema: WpCustomTaskScaffoldInputSchema,
};

export async function wpCustomTaskScaffoldHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpCustomTaskScaffoldOutput> {
  const input: WpCustomTaskScaffoldInput =
    WpCustomTaskScaffoldInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "CUSTOM_UNSUPPORTED_TARGET",
      "task_scaffold requires a `rest` target.",
      { target_kind: target.kind },
    );
  }

  let pluginInitialized = false;
  if (!(await isPluginInstalled(target))) {
    if (!input.auto_init) {
      throw new WplabError(
        "CUSTOM_PLUGIN_NOT_INSTALLED",
        "Rolepod Custom plugin is not installed on this site and auto_init=false. Run rolepod_wp_custom_init first.",
        {},
      );
    }
    await installPluginSkeleton(target);
    await target.wpCli(["plugin", "activate", "rolepod-custom"], {
      allowDestructive: true,
      timeoutMs: 30_000,
    });
    pluginInitialized = true;
  }

  const modulePath = modulePathFor(input.task_id);
  if (await target.fileExists(modulePath)) {
    throw new WplabError(
      "CUSTOM_TASK_ALREADY_EXISTS",
      `task '${input.task_id}' already exists at ${modulePath}. Use rolepod_wp_custom_task_update to modify in place.`,
      { task_id: input.task_id, module_path: modulePath },
    );
  }

  const php = buildTaskModulePhp({
    taskId: input.task_id,
    title: input.title,
    description: input.description,
    settings: input.settings,
    hooksBody: input.hooks_body,
    ...(input.extra_methods !== undefined
      ? { extraMethods: input.extra_methods }
      : {}),
  });

  const bridge = await bridgeFor(target);
  const result = await bridge.fileWriteBatch(
    [{ path: modulePath, content: php }],
    { skipPhpLint: false },
  );
  const w = result.written[0]!;

  await recordChange(target, {
    category: "file",
    subcategory: input.task_id,
    targetDescriptor: `scaffold task ${input.task_id} (${w.bytesWritten} bytes)`,
    afterState: {
      task_id: input.task_id,
      title: input.title,
      module_path: modulePath,
    },
    reversible: true,
    sourceTool: "wp_custom_task_scaffold",
  });

  return WpCustomTaskScaffoldOutputSchema.parse({
    task_id: input.task_id,
    title: input.title,
    module_path: modulePath,
    bytes_written: w.bytesWritten,
    plugin_initialized: pluginInitialized,
  });
}
