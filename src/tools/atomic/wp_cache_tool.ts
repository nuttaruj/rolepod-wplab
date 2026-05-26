import {
  CacheToolInputSchema,
  CacheToolOutputSchema,
  type CacheToolInput,
  type CacheToolOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import type { Target } from "../../runtime/Target.js";

export const wpCacheToolToolDef = {
  name: "rolepod_wp_cache_tool",
  description:
    "WP cache + transients: op=inspect (object-cache type + transient counts), op=flush_object (wp cache flush), op=flush_transients (wp transient delete --all --expired). Mutations require confirm=true.",
  inputSchema: CacheToolInputSchema,
};

async function ensureShellTarget(target: Target): Promise<void> {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker"
  ) {
    throw new WplabError(
      "CACHE_REQUIRES_SHELL",
      "wp_cache_tool requires shell target (wp-cli).",
      { kind: target.kind },
    );
  }
}

export async function wpCacheToolHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<CacheToolOutput> {
  const input: CacheToolInput = CacheToolInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  await ensureShellTarget(target);

  if (input.op === "inspect") {
    const cacheType = await target.wpCli(["cache", "type"]);
    const transientCount = await target.wpCli([
      "transient",
      "list",
      "--network=false",
      "--format=count",
    ]);
    let txCount = 0;
    if (transientCount.exitCode === 0) {
      const parsed = Number.parseInt(transientCount.stdout.trim(), 10);
      txCount = Number.isFinite(parsed) ? parsed : 0;
    }
    return CacheToolOutputSchema.parse({
      op: "inspect",
      object_cache_active:
        cacheType.exitCode === 0 && !/^Default/i.test(cacheType.stdout.trim()),
      transient_count: txCount,
      expired_transient_count: 0,
    });
  }

  if (!input.confirm) {
    throw new WplabError(
      "CACHE_CONFIRM_REQUIRED",
      `op=${input.op} requires confirm=true`,
      {},
    );
  }

  if (input.op === "flush_object") {
    const r = await target.wpCli(["cache", "flush"], {
      allowDestructive: true,
    });
    if (r.exitCode !== 0) {
      throw new WplabError("CACHE_FLUSH_FAILED", r.stderr.slice(0, 200), {
        exitCode: r.exitCode,
      });
    }
    return CacheToolOutputSchema.parse({ op: "flush_object", flushed: true });
  }

  // flush_transients
  const expired = await target.wpCli(["transient", "delete-expired"], {
    allowDestructive: true,
  });
  const all = await target.wpCli(["transient", "delete", "--all"], {
    allowDestructive: true,
  });
  if (expired.exitCode !== 0 && all.exitCode !== 0) {
    throw new WplabError(
      "CACHE_TRANSIENT_FLUSH_FAILED",
      `${expired.stderr} ${all.stderr}`.slice(0, 200),
      {},
    );
  }
  return CacheToolOutputSchema.parse({ op: "flush_transients", flushed: true });
}
