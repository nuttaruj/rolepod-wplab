/**
 * rolepod_wp_elementor_publish — the missing "I just edited an Elementor
 * page, please make it actually show up live" tool.
 *
 * Before this, every Elementor write needed three separate calls + a manual
 * cache-bust query string in the browser:
 *
 *   1. wp elementor flush-css                       # regen per-page CSS
 *   2. wp cache flush                                # bust object cache
 *   3. visit /the-page?nocache=N                     # warm Varnish
 *
 * This tool collapses them into one call against a known post_id, returns
 * the permalink, and reports per-phase status so a failed flush surfaces
 * loudly instead of silently continuing.
 */
import { performance } from "node:perf_hooks";
import {
  WpElementorPublishInputSchema,
  WpElementorPublishOutputSchema,
  type WpElementorPublishInput,
  type WpElementorPublishOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import { log } from "../../util/log.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorPublishToolDef = {
  name: "rolepod_wp_elementor_publish",
  description:
    "After editing an Elementor page programmatically, call this once with `post_id` to flush Elementor's per-page CSS, bust the WP object cache, and (by default) fetch the post's permalink once to warm the Varnish layer. Replaces the three-step flush dance you'd otherwise have to remember. Per-phase status returned in case one of them fails. Requires wp-cli on the target.",
  inputSchema: WpElementorPublishInputSchema,
};

export async function wpElementorPublishHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpElementorPublishOutput> {
  const input: WpElementorPublishInput = WpElementorPublishInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // Resolve permalink once via wp eval (no companion required).
  const permalinkCall = await target.wpCli(
    ["eval", `echo get_permalink(${input.post_id});`],
    { allowDestructive: false, timeoutMs: 10_000 },
  );
  const permalink = permalinkCall.stdout.trim();
  if (!permalink || !/^https?:\/\//.test(permalink)) {
    throw new WplabError(
      "ELEMENTOR_PUBLISH_BAD_POST",
      `wp could not resolve a permalink for post ${input.post_id}. Verify the post exists and is published.`,
      { post_id: input.post_id, wp_cli_stdout: permalinkCall.stdout, wp_cli_stderr: permalinkCall.stderr },
    );
  }

  // Phase 1: per-page CSS regen.
  const flushCss = await target.wpCli(
    ["elementor", "flush-css"],
    { allowDestructive: true, timeoutMs: 60_000 },
  );

  // Phase 2: object cache flush.
  const cacheFlush = await target.wpCli(
    ["cache", "flush"],
    { allowDestructive: true, timeoutMs: 10_000 },
  );

  let warm:
    | { ok: boolean; status: number; bytes: number; duration_ms: number }
    | undefined;
  if (input.warm_cache) {
    warm = await warmFetch(permalink);
  }

  const out: WpElementorPublishOutput = WpElementorPublishOutputSchema.parse({
    post_id: input.post_id,
    permalink,
    elementor_flush: {
      ok: flushCss.exitCode === 0,
      message: flushCss.exitCode === 0 ? flushCss.stdout.trim() : flushCss.stderr.trim(),
    },
    object_cache_flush: {
      ok: cacheFlush.exitCode === 0,
      message: cacheFlush.exitCode === 0 ? cacheFlush.stdout.trim() : cacheFlush.stderr.trim(),
    },
    ...(warm !== undefined ? { warm_fetch: warm } : {}),
  });

  log.info("elementor_publish complete", {
    post_id: input.post_id,
    permalink,
    elementor_flush_ok: out.elementor_flush.ok,
    cache_flush_ok: out.object_cache_flush.ok,
  });
  return out;
}

async function warmFetch(url: string): Promise<{
  ok: boolean;
  status: number;
  bytes: number;
  duration_ms: number;
}> {
  const start = performance.now();
  try {
    // Cache-busting query so Varnish doesn't return a stale cached body.
    const u = new URL(url);
    u.searchParams.set("rolepod_publish", String(Date.now()));
    const res = await fetch(u.toString(), {
      method: "GET",
      headers: { "User-Agent": "rolepod-wplab/elementor_publish (+warm)" },
    });
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      bytes: text.length,
      duration_ms: Math.round(performance.now() - start),
    };
  } catch (err) {
    log.debug("warm fetch failed", { url, err: (err as Error).message });
    return {
      ok: false,
      status: 0,
      bytes: 0,
      duration_ms: Math.round(performance.now() - start),
    };
  }
}
