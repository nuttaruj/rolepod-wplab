import {
  CronToolInputSchema,
  CronToolOutputSchema,
  type CronToolInput,
  type CronToolOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import type { Target } from "../../runtime/Target.js";

export const wpCronToolToolDef = {
  name: "rolepod_wp_cron_tool",
  description:
    "WP-Cron: op=list (read scheduled events), op=run (fire a specific hook now), op=delete (unschedule a hook). Run/delete require hook + confirm=true. Routes via wp-cli (local/ssh/docker direct, RestTarget via companion v2.1+).",
  inputSchema: CronToolInputSchema,
};

async function ensureShellTarget(_target: Target): Promise<void> {
  // No-op since v1.4 — RestTarget routes wp-cli through companion endpoint.
  // Kept as a stable injection point in case future target kinds need a guard.
}

export async function wpCronToolHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<CronToolOutput> {
  const input: CronToolInput = CronToolInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  await ensureShellTarget(target);

  if (input.op === "list") {
    const r = await target.wpCli(["cron", "event", "list", "--format=json"]);
    if (r.exitCode !== 0) {
      throw new WplabError("CRON_LIST_FAILED", r.stderr.slice(0, 200), {
        exitCode: r.exitCode,
      });
    }
    let rows: Array<{
      hook: string;
      next_run_relative: string;
      next_run_gmt: string;
      recurrence: string;
    }> = [];
    try {
      rows = JSON.parse(r.stdout || "[]");
    } catch {
      rows = [];
    }
    return CronToolOutputSchema.parse({ op: "list", events: rows });
  }

  if (input.hook === undefined || input.hook.trim() === "") {
    throw new WplabError(
      "CRON_HOOK_REQUIRED",
      `op=${input.op} requires hook`,
      {},
    );
  }
  if (!input.confirm) {
    throw new WplabError(
      "CRON_CONFIRM_REQUIRED",
      `op=${input.op} requires confirm=true`,
      {},
    );
  }

  if (input.op === "run") {
    const r = await target.wpCli(["cron", "event", "run", input.hook], {
      allowDestructive: true,
    });
    if (r.exitCode !== 0) {
      throw new WplabError("CRON_RUN_FAILED", r.stderr.slice(0, 200), {
        exitCode: r.exitCode,
      });
    }
    return CronToolOutputSchema.parse({ op: "run", ran: [input.hook] });
  }

  // delete
  const r = await target.wpCli(["cron", "event", "delete", input.hook], {
    allowDestructive: true,
  });
  if (r.exitCode !== 0) {
    throw new WplabError("CRON_DELETE_FAILED", r.stderr.slice(0, 200), {
      exitCode: r.exitCode,
    });
  }
  return CronToolOutputSchema.parse({ op: "delete", deleted_count: 1 });
}
