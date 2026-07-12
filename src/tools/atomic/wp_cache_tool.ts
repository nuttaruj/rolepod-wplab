import {
  CacheToolInputSchema,
  CacheToolOutputSchema,
  type CacheToolInput,
  type CacheToolOutput,
} from "../../schema/tools.js";
import { detectCacheLayers, purgePageCache } from "../../lib/cacheLayers.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import type { Target } from "../../runtime/Target.js";

export const wpCacheToolToolDef = {
  name: "rolepod_wp_cache_tool",
  description:
    "WP cache + transients. op=inspect (object-cache type + transient counts) · op=detect (read-only: enumerate the object / page-cache-plugin / host-CDN layers, which are purgeable, and which need the host panel) · op=flush_object (wp cache flush — clears the OBJECT cache ONLY, not the page cache) · op=flush_transients · op=flush_page (purge page-cache plugins with a known wp-cli command; host/CDN + unknown plugins are reported manual_required, never faked). Mutations (flush_*) require confirm=true. Every cache report carries a caveat: a cache MISS hides its headers, so 'no cache seen' does not mean 'no cache exists'.",
  inputSchema: CacheToolInputSchema,
};

async function ensureShellTarget(_target: Target): Promise<void> {
  // No-op since v1.4 — RestTarget routes wp-cli through companion endpoint.
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

  if (input.op === "detect") {
    const report = await detectCacheLayers(target);
    return CacheToolOutputSchema.parse({
      op: "detect",
      layers: report.layers as unknown as Array<Record<string, unknown>>,
      caveat: report.caveat,
      multisite: report.multisite,
    });
  }

  if (!input.confirm) {
    throw new WplabError(
      "CACHE_CONFIRM_REQUIRED",
      `op=${input.op} requires confirm=true`,
      {},
    );
  }

  if (input.op === "flush_page") {
    const report = await detectCacheLayers(target);
    const result = await purgePageCache(target, report);
    return CacheToolOutputSchema.parse({
      op: "flush_page",
      purged: result.purged,
      manual_required: result.manual_required,
      failed: result.failed as unknown as Array<Record<string, unknown>>,
      caveat: result.caveat,
      multisite: report.multisite,
    });
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
