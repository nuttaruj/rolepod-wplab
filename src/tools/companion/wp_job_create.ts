import { bridgeFor } from "../../companion/Bridge.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import {
  WpJobCreateInputSchema,
  WpJobCreateOutputSchema,
  type WpJobCreateInput,
  type WpJobCreateOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpJobCreateToolDef = {
  name: "rolepod_wp_job_create",
  description:
    "Fire-and-poll wp-cli runner. Spawns wp-cli detached on the target, returns a job_id immediately. Use for db migrations, theme switches with cache rebuild, media regeneration — anything that exceeds the synchronous wp-cli 120s hard cap. Pair with `rolepod_wp_job_status` to poll until completion. TTL 1h. Requires rolepod-wp companion v2.12+ and exec() enabled on the host (returns 503 EXEC_DISABLED if not).",
  inputSchema: WpJobCreateInputSchema,
};

export async function wpJobCreateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpJobCreateOutput> {
  const input: WpJobCreateInput = WpJobCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (input.allow_destructive) {
    prodGuard.enforce(target.siteurl);
  }
  if (target.kind !== "rest") {
    throw new WplabError(
      "JOB_CREATE_UNSUPPORTED_TARGET",
      "job_create currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.jobCreate({
    args: input.args,
    timeoutSeconds: input.timeout_seconds,
    allowDestructive: input.allow_destructive,
  });
  return WpJobCreateOutputSchema.parse({
    job_id: r.jobId,
    pid: r.pid,
    log: r.log,
    started_at: r.startedAt,
    ttl_seconds: r.ttlSeconds,
  });
}
