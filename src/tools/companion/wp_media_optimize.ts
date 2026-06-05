import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpMediaOptimizeInputSchema,
  WpMediaOptimizeOutputSchema,
  type WpMediaOptimizeInput,
  type WpMediaOptimizeOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpMediaOptimizeToolDef = {
  name: "rolepod_wp_media_optimize",
  description:
    "Bulk-optimize media-library images over a byte threshold, IN WordPress (the companion recompresses/downscales originals; already-small or already-compressed files are skipped). Originals are backed up + ledgered before overwrite, and a re-encode that doesn't shrink is reverted. mode=immediate apply=false → dry run (list candidates + sizes, writes nothing); mode=immediate apply=true → optimize up to `limit` now; mode=enqueue → hand ALL matching images to a throttled background queue (small batches via cron, never spikes CPU — watch progress on the WP Media admin page). Requires rolepod-wp companion v2.16+ on a rest target.",
  inputSchema: WpMediaOptimizeInputSchema,
};

function requireCompanion(t: Target): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "MEDIA_OPTIMIZE_REQUIRES_COMPANION",
      `media-optimize requires a rest target with the rolepod-wp companion — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { target_kind: t.kind },
    );
  }
}

export async function wpMediaOptimizeHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpMediaOptimizeOutput> {
  const input: WpMediaOptimizeInput = WpMediaOptimizeInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  requireCompanion(target);
  const bridge = await bridgeFor(target);
  const body = await bridge.mediaOptimize({
    mode: input.mode,
    apply: input.apply,
    min_bytes: input.min_bytes,
    max_dimension: input.max_dimension,
    quality: input.quality,
    limit: input.limit,
  });
  return WpMediaOptimizeOutputSchema.parse(body);
}
