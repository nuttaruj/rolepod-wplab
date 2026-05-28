import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpJobStatusInputSchema,
  WpJobStatusOutputSchema,
  type WpJobStatusInput,
  type WpJobStatusOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpJobStatusToolDef = {
  name: "rolepod_wp_job_status",
  description:
    "Poll a job created via `rolepod_wp_job_create`. Returns running/completed/failed state, elapsed time, plus the tail of stdout + stderr logs (default 8KB, max 64KB). Pair with a polling loop on your side — the companion does not push notifications. Requires rolepod-wp companion v2.12+.",
  inputSchema: WpJobStatusInputSchema,
};

export async function wpJobStatusHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpJobStatusOutput> {
  const input: WpJobStatusInput = WpJobStatusInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (target.kind !== "rest") {
    throw new WplabError(
      "JOB_STATUS_UNSUPPORTED_TARGET",
      "job_status currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.jobStatus(input.job_id, { tail: input.tail });
  return WpJobStatusOutputSchema.parse({
    job_id: r.jobId,
    pid: r.pid,
    args: r.args,
    started_at: r.startedAt,
    state: r.state,
    elapsed_seconds: r.elapsedSeconds,
    stdout_tail: r.stdoutTail,
    stderr_tail: r.stderrTail,
    log: r.log,
    ...(r.exitCode !== undefined ? { exit_code: r.exitCode } : {}),
  });
}
