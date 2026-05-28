import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  WpCustomTaskRemoveInputSchema,
  WpCustomTaskRemoveOutputSchema,
  type WpCustomTaskRemoveInput,
  type WpCustomTaskRemoveOutput,
} from "../../schema/tools.js";
import {
  isPluginInstalled,
  modulePathFor,
  runTaskUninstall,
} from "../../lib/rolepodCustomOps.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomTaskRemoveToolDef = {
  name: "rolepod_wp_custom_task_remove",
  description:
    "Remove a Rolepod Custom task. Runs the task's uninstall() method via wp eval (delete options, unhook callbacks, drop CPTs the task created) — unless run_uninstall=false — then deletes the module file. TaskRegistry's next glob will silently skip the removed file. Recorded in the Change Ledger as a file deletion with the old content snapshot, so revert is mechanical.",
  inputSchema: WpCustomTaskRemoveInputSchema,
};

export async function wpCustomTaskRemoveHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpCustomTaskRemoveOutput> {
  const input: WpCustomTaskRemoveInput = WpCustomTaskRemoveInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "CUSTOM_UNSUPPORTED_TARGET",
      "task_remove requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  if (!(await isPluginInstalled(target))) {
    throw new WplabError(
      "CUSTOM_PLUGIN_NOT_INSTALLED",
      "Rolepod Custom plugin is not installed.",
      {},
    );
  }
  const modulePath = modulePathFor(input.task_id);
  if (!(await target.fileExists(modulePath))) {
    throw new WplabError(
      "CUSTOM_TASK_NOT_FOUND",
      `task '${input.task_id}' not found at ${modulePath}`,
      { task_id: input.task_id },
    );
  }

  const previous = await target.fileRead(modulePath);

  let uninstallRun = false;
  if (input.run_uninstall) {
    uninstallRun = await runTaskUninstall(target, input.task_id);
  }

  // Delete by writing an empty stub then unlinking via wp eval — fs-write
  // tool doesn't have a delete primitive yet, but the @unlink call inside
  // wp eval is scoped + audited.
  const deleteResult = await target.wpCli(
    [
      "eval",
      `\\$p = '${modulePath.replace(/'/g, "\\'")}'; \\$abs = ABSPATH . \\$p; if (is_file(\\$abs)) { \\$ok = @unlink(\\$abs); echo \\$ok ? 'deleted' : 'unlink_failed'; } else { echo 'missing'; }`,
    ],
    { allowDestructive: true, timeoutMs: 10_000 },
  );
  const fileDeleted = deleteResult.exitCode === 0 && deleteResult.stdout.trim() === "deleted";
  if (!fileDeleted) {
    throw new WplabError(
      "CUSTOM_TASK_REMOVE_FAILED",
      `could not delete ${modulePath}: ${deleteResult.stdout || deleteResult.stderr}`,
      { task_id: input.task_id, module_path: modulePath },
    );
  }

  await recordChange(target, {
    category: "file",
    subcategory: input.task_id,
    targetDescriptor: `remove task ${input.task_id}`,
    beforeState: { content: previous.content, absolute_path: modulePath },
    afterState: { content: null, absolute_path: modulePath },
    reversible: true,
    sourceTool: "wp_custom_task_remove",
  });

  return WpCustomTaskRemoveOutputSchema.parse({
    task_id: input.task_id,
    module_path: modulePath,
    uninstall_run: uninstallRun,
    file_deleted: fileDeleted,
  });
}
