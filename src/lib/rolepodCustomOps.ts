/**
 * Shared ops for the Rolepod Custom plugin scaffolder.
 *
 * Lazy-install + per-task CRUD. Operates entirely through existing wplab
 * primitives (fs-write-batch, fs-list, wp-cli, option-set). No new
 * companion endpoint required.
 */
import {
  ROLEPOD_CUSTOM_PLUGIN_DIR,
  ROLEPOD_CUSTOM_MAIN_FILE,
  ROLEPOD_CUSTOM_MODULES_DIR,
  TPL_MAIN_FILE,
  TPL_UNINSTALL,
  TPL_PLUGIN_CLASS,
  TPL_TASK_REGISTRY,
  TPL_BASE_TASK,
  TPL_ADMIN_MENU,
  TPL_ADMIN_CSS,
  TPL_README,
  renderTaskModulePhp,
  taskClassName,
  type TaskScaffoldInput,
} from "./rolepodCustomTemplates.js";
import { WplabError } from "../util/errors.js";
import { bridgeFor } from "../companion/Bridge.js";
import type { Target } from "../runtime/Target.js";

/**
 * Detect whether the plugin already exists on the target. Used to short-
 * circuit the init batch write and to gate scaffolds.
 */
export async function isPluginInstalled(target: Target): Promise<boolean> {
  try {
    return await target.fileExists(ROLEPOD_CUSTOM_MAIN_FILE);
  } catch {
    return false;
  }
}

/**
 * Write the full plugin skeleton to the target via fs-write-batch — atomic
 * commit, automatic rollback on any failure. Idempotent: returns
 * was_already_installed:true without rewriting when the main file is
 * present.
 */
export async function installPluginSkeleton(
  target: Target,
): Promise<{ files_written: number; was_already_installed: boolean }> {
  if (await isPluginInstalled(target)) {
    return { files_written: 0, was_already_installed: true };
  }
  if (target.kind !== "rest") {
    throw new WplabError(
      "CUSTOM_UNSUPPORTED_TARGET",
      "rolepod_wp_custom_* tools currently require a `rest` target (uses fs-write-batch).",
      { target_kind: target.kind },
    );
  }

  const bridge = await bridgeFor(target);
  const writes = [
    { path: ROLEPOD_CUSTOM_MAIN_FILE, content: TPL_MAIN_FILE },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/uninstall.php`,
      content: TPL_UNINSTALL,
    },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/inc/Plugin.php`,
      content: TPL_PLUGIN_CLASS,
    },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/inc/TaskRegistry.php`,
      content: TPL_TASK_REGISTRY,
    },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/inc/BaseTask.php`,
      content: TPL_BASE_TASK,
    },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/inc/AdminMenu.php`,
      content: TPL_ADMIN_MENU,
    },
    {
      path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/assets/admin.css`,
      content: TPL_ADMIN_CSS,
    },
    { path: `${ROLEPOD_CUSTOM_PLUGIN_DIR}/readme.txt`, content: TPL_README },
  ];
  const result = await bridge.fileWriteBatch(writes, { skipPhpLint: false });
  return {
    files_written: result.written.length,
    was_already_installed: false,
  };
}

export function modulePathFor(taskId: string): string {
  return `${ROLEPOD_CUSTOM_MODULES_DIR}/${taskClassName(taskId)}.php`;
}

/**
 * Compose the PHP source of a task module from the scaffold input.
 */
export function buildTaskModulePhp(input: TaskScaffoldInput): string {
  return renderTaskModulePhp(input);
}

/**
 * List registered tasks by enumerating `inc/Modules/*Task.php` then parsing
 * each one for id/title/description via lightweight regex. Reading via
 * companion fs-list avoids requiring the plugin to be active.
 */
export interface ListedTask {
  taskId: string;
  title: string;
  description: string;
  enabled: boolean;
  modulePath: string;
}

export async function listTasks(target: Target): Promise<{
  plugin_installed: boolean;
  tasks: ListedTask[];
}> {
  if (target.kind !== "rest") {
    throw new WplabError(
      "CUSTOM_UNSUPPORTED_TARGET",
      "list requires rest target.",
      { target_kind: target.kind },
    );
  }
  if (!(await isPluginInstalled(target))) {
    return { plugin_installed: false, tasks: [] };
  }
  const bridge = await bridgeFor(target);
  const listing = await bridge.fileList(ROLEPOD_CUSTOM_MODULES_DIR, {
    depth: 1,
    includeHidden: false,
  });
  const tasks: ListedTask[] = [];
  for (const entry of listing.entries) {
    if (entry.type !== "file") continue;
    if (!entry.path.endsWith("Task.php")) continue;
    const fileContent = await target.fileRead(entry.path).catch(() => null);
    if (!fileContent) continue;
    const parsed = parseTaskMetaFromSource(fileContent.content);
    if (!parsed) continue;
    const enabled = await readTaskEnabled(target, parsed.taskId);
    tasks.push({
      taskId: parsed.taskId,
      title: parsed.title,
      description: parsed.description,
      enabled,
      modulePath: entry.path,
    });
  }
  tasks.sort((a, b) => a.taskId.localeCompare(b.taskId));
  return { plugin_installed: true, tasks };
}

/**
 * Read the enabled flag stored under `rolepod_custom_<task>_enabled` option.
 */
export async function readTaskEnabled(
  target: Target,
  taskId: string,
): Promise<boolean> {
  const optionKey = `rolepod_custom_${taskId.replace(/-/g, "_")}_enabled`;
  try {
    const r = await target.wpCli(
      ["option", "get", optionKey, "--format=json"],
      {
        allowDestructive: false,
        timeoutMs: 10_000,
      },
    );
    if (r.exitCode !== 0) return true; // missing option defaults to enabled
    const raw = r.stdout.trim();
    if (raw === "" || raw === "false" || raw === "0" || raw === '"0"')
      return false;
    return true;
  } catch {
    return true;
  }
}

export async function setTaskEnabled(
  target: Target,
  taskId: string,
  enabled: boolean,
): Promise<void> {
  const optionKey = `rolepod_custom_${taskId.replace(/-/g, "_")}_enabled`;
  await target.wpCli(["option", "update", optionKey, enabled ? "1" : "0"], {
    allowDestructive: true,
    timeoutMs: 10_000,
  });
}

/**
 * Lightweight PHP source parser — extracts id/title/description from the
 * return-statement bodies via regex. Robust enough for generated code; we
 * own the template so we know the shape is stable.
 */
function parseTaskMetaFromSource(
  source: string,
): { taskId: string; title: string; description: string } | null {
  const idMatch = source.match(
    /public function id\(\): string\s*\{\s*return '([^']+)'/,
  );
  const titleMatch = source.match(
    /public function title\(\): string\s*\{\s*return '([^']+)'/,
  );
  const descMatch = source.match(
    /public function description\(\): string\s*\{\s*return '([^']+)'/,
  );
  if (!idMatch || !titleMatch || !descMatch) return null;
  return {
    taskId: idMatch[1]!.replace(/\\'/g, "'"),
    title: titleMatch[1]!.replace(/\\'/g, "'"),
    description: descMatch[1]!.replace(/\\'/g, "'"),
  };
}

/**
 * Run the task's uninstall() via wp eval, returning true on clean run.
 */
export async function runTaskUninstall(
  target: Target,
  taskId: string,
): Promise<boolean> {
  const className = taskClassName(taskId);
  const code = `
    if ( ! class_exists('\\\\Rolepod\\\\Custom\\\\Modules\\\\${className}') ) {
      echo wp_json_encode(['ok' => false, 'reason' => 'class_missing']);
      exit;
    }
    \\$task = new \\\\Rolepod\\\\Custom\\\\Modules\\\\${className}();
    if ( ! method_exists(\\$task, 'uninstall') ) {
      echo wp_json_encode(['ok' => false, 'reason' => 'no_uninstall']);
      exit;
    }
    \\$task->uninstall();
    echo wp_json_encode(['ok' => true]);
  `
    .replace(/\s+/g, " ")
    .trim();
  const r = await target.wpCli(["eval", code], {
    allowDestructive: true,
    timeoutMs: 30_000,
  });
  if (r.exitCode !== 0) return false;
  try {
    const parsed = JSON.parse(r.stdout.trim()) as { ok: boolean };
    return !!parsed.ok;
  } catch {
    return false;
  }
}
