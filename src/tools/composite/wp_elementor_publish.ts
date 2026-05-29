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
  const input: WpElementorPublishInput =
    WpElementorPublishInputSchema.parse(raw);
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
      {
        post_id: input.post_id,
        wp_cli_stdout: permalinkCall.stdout,
        wp_cli_stderr: permalinkCall.stderr,
      },
    );
  }

  // Phase 1: per-page CSS regen.
  const flushCss = await target.wpCli(["elementor", "flush-css"], {
    allowDestructive: true,
    timeoutMs: 60_000,
  });

  // Phase 2: object cache flush.
  const cacheFlush = await target.wpCli(["cache", "flush"], {
    allowDestructive: true,
    timeoutMs: 10_000,
  });

  // Phase 2.5 — bump filemtime on theme assets so the enqueue ?ver= param
  // updates and the CDN/browser cache stops serving stale CSS/JS bodies.
  let themeBump:
    | { ok: boolean; files_touched: number; theme_dir: string }
    | undefined;
  if (input.bump_theme_assets) {
    themeBump = await bumpThemeAssets(target);
  }

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
      message:
        flushCss.exitCode === 0
          ? flushCss.stdout.trim()
          : flushCss.stderr.trim(),
    },
    object_cache_flush: {
      ok: cacheFlush.exitCode === 0,
      message:
        cacheFlush.exitCode === 0
          ? cacheFlush.stdout.trim()
          : cacheFlush.stderr.trim(),
    },
    ...(themeBump !== undefined ? { theme_assets_bumped: themeBump } : {}),
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

/**
 * Bump filemtime() on every *.css and *.js under the active theme's assets/
 * dir. The theme's enqueue layer derives ?ver=<filemtime>, so this forces
 * new query strings → CDN/browser cache miss → fresh asset bodies served.
 *
 * Walks via wp eval (avoids needing fs-list endpoint to be live).
 */
async function bumpThemeAssets(
  target: import("../../runtime/Target.js").Target,
): Promise<{ ok: boolean; files_touched: number; theme_dir: string }> {
  const code = `
    $theme = get_stylesheet_directory();
    $count = 0;
    if (is_dir($theme . '/assets')) {
      $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($theme . '/assets'));
      foreach ($rii as $f) {
        if (!$f->isFile()) continue;
        $ext = strtolower($f->getExtension());
        if ($ext === 'css' || $ext === 'js') {
          @touch($f->getPathname(), time());
          $count++;
        }
      }
    }
    echo wp_json_encode(['count' => $count, 'theme_dir' => $theme]);
  `
    .trim()
    .replace(/\s+/g, " ");
  try {
    const res = await target.wpCli(["eval", code], {
      allowDestructive: true,
      timeoutMs: 30_000,
    });
    if (res.exitCode !== 0) {
      return { ok: false, files_touched: 0, theme_dir: "" };
    }
    const out = JSON.parse(res.stdout.trim()) as {
      count: number;
      theme_dir: string;
    };
    return {
      ok: true,
      files_touched: out.count ?? 0,
      theme_dir: out.theme_dir ?? "",
    };
  } catch (err) {
    log.debug("bumpThemeAssets failed", { err: (err as Error).message });
    return { ok: false, files_touched: 0, theme_dir: "" };
  }
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
