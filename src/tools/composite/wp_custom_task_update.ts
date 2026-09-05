import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import {
  WpCustomTaskUpdateInputSchema,
  WpCustomTaskUpdateOutputSchema,
  type WpCustomTaskUpdateInput,
  type WpCustomTaskUpdateOutput,
} from "../../schema/tools.js";
import {
  buildTaskModulePhp,
  isPluginInstalled,
  modulePathFor,
} from "../../lib/rolepodCustomOps.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCustomTaskUpdateToolDef = {
  name: "rolepod_wp_custom_task_update",
  description:
    "Modify an existing Rolepod Custom task in place. Pass only the fields you want to change — title, description, settings, hooks_body, extra_methods. Existing values for omitted fields are preserved by reading them from the current module file. Writes via fs-write-batch (atomic), so a malformed update rolls back instead of corrupting the module.",
  inputSchema: WpCustomTaskUpdateInputSchema,
};

interface ParsedModule {
  taskId: string;
  title: string;
  description: string;
  settingsBlock: string;
  hooksBody: string;
}

export async function wpCustomTaskUpdateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpCustomTaskUpdateOutput> {
  const input: WpCustomTaskUpdateInput =
    WpCustomTaskUpdateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "CUSTOM_UNSUPPORTED_TARGET",
      "task_update requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  if (!(await isPluginInstalled(target))) {
    throw new WplabError(
      "CUSTOM_PLUGIN_NOT_INSTALLED",
      "Rolepod Custom plugin is not installed. Run rolepod_wp_custom_init first.",
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

  const current = await target.fileRead(modulePath);
  const parsed = parseExistingModule(current.content);

  // Compose updated PHP. For omitted fields we keep the parsed-out original.
  const updatedSettings = input.settings ?? null;

  let php: string;
  if (
    updatedSettings !== null ||
    input.hooks_body !== undefined ||
    input.extra_methods !== undefined ||
    input.title !== undefined ||
    input.description !== undefined
  ) {
    php = buildTaskModulePhp({
      taskId: input.task_id,
      title: input.title ?? parsed.title,
      description: input.description ?? parsed.description,
      settings: updatedSettings ?? [],
      hooksBody: input.hooks_body ?? parsed.hooksBody,
      ...(input.extra_methods !== undefined
        ? { extraMethods: input.extra_methods }
        : {}),
    });
  } else {
    return WpCustomTaskUpdateOutputSchema.parse({
      task_id: input.task_id,
      module_path: modulePath,
      bytes_written: current.bytes,
    });
  }

  const bridge = await bridgeFor(target);
  const result = await bridge.fileWriteBatch(
    [{ path: modulePath, content: php }],
    { skipPhpLint: false },
  );
  const w = result.written[0]!;

  await recordChange(target, {
    category: "file",
    subcategory: input.task_id,
    targetDescriptor: `update task ${input.task_id} (${w.bytesWritten} bytes)`,
    beforeState: { content: current.content },
    afterState: { content: php, module_path: modulePath },
    reversible: true,
    sourceTool: "wp_custom_task_update",
  });

  return WpCustomTaskUpdateOutputSchema.parse({
    task_id: input.task_id,
    module_path: modulePath,
    bytes_written: w.bytesWritten,
  });
}

function parseExistingModule(source: string): ParsedModule {
  const idMatch = source.match(
    /public function id\(\): string\s*\{\s*return '([^']*)'/,
  );
  const titleMatch = source.match(
    /public function title\(\): string\s*\{\s*return '([^']*)'/,
  );
  const descMatch = source.match(
    /public function description\(\): string\s*\{\s*return '([^']*)'/,
  );
  const hooksMatch = source.match(
    /public function register_hooks\(\): void\s*\{\n([\s\S]*?)\n\t\}/,
  );
  return {
    taskId: idMatch?.[1] ?? "",
    title: titleMatch?.[1] ?? "",
    description: descMatch?.[1] ?? "",
    settingsBlock: "",
    hooksBody: hooksMatch?.[1]?.replace(/^\t\t/gm, "") ?? "// no hooks",
  };
}
