import type { Target } from "../runtime/Target.js";

/**
 * Page-cache visibility + purge. WordPress's own `wp cache flush` clears the
 * OBJECT cache (Redis/Memcached/DB) — it does NOT touch a page-cache plugin's
 * full-page store or a host/CDN edge cache. This module detects those layers
 * and purges the ones with a KNOWN-GOOD wp-cli command; everything else is
 * reported as manual_required rather than pretended-purged.
 */

export interface CacheLayer {
  name: string;
  kind: "object" | "plugin" | "host";
  detected: boolean;
  /** True only when we have a verified wp-cli purge command for this layer. */
  purgeable: boolean;
  purge_argv?: string[];
  /** True when the only way to purge is the host/CDN panel (no wp-cli path). */
  manual_required: boolean;
  note?: string;
}

export interface CacheLayersReport {
  layers: CacheLayer[];
  /** Always present — a MISS hides cache headers, so "none seen" ≠ "none exist". */
  caveat: string;
  multisite: boolean;
}

const BLANKET_CAVEAT =
  "A host or CDN page cache may exist even though no cache header appeared on this fetch — a cache MISS serves the request without the header. Confirm at the host / CDN panel before assuming a page is uncached.";

// Page-cache plugins with a RELIABLE, verified wp-cli purge command.
const PAGE_CACHE_PURGEABLE: Array<{
  slug: RegExp;
  name: string;
  purge_argv: string[];
}> = [
  {
    slug: /litespeed-cache/i,
    name: "LiteSpeed Cache",
    purge_argv: ["litespeed-purge", "all"],
  },
  { slug: /wp-rocket/i, name: "WP Rocket", purge_argv: ["rocket", "clean"] },
  {
    slug: /w3-total-cache/i,
    name: "W3 Total Cache",
    purge_argv: ["w3-total-cache", "flush", "all"],
  },
];

// Page-cache plugins WITHOUT a reliable wp-cli purge — reported manual, never
// faked. Guessing a purge command here is exactly the wrong-data bug class the
// audit closes, so these stay manual.
const PAGE_CACHE_MANUAL: Array<{ slug: RegExp; name: string }> = [
  { slug: /wp-super-cache/i, name: "WP Super Cache" },
  { slug: /wp-fastest-cache/i, name: "WP Fastest Cache" },
  { slug: /cache-enabler/i, name: "Cache Enabler" },
  { slug: /(^|\/)breeze/i, name: "Breeze" },
  { slug: /sg-cachepress/i, name: "SiteGround Speed Optimizer" },
  { slug: /nginx-helper/i, name: "Nginx Helper" },
];

// Host / CDN edge cache signalled by a response header on the homepage.
const HOST_HEADER_SIGNALS: Array<{ header: string; name: string }> = [
  { header: "cf-cache-status", name: "Cloudflare" },
  { header: "x-litespeed-cache", name: "LiteSpeed server cache" },
  { header: "x-varnish", name: "Varnish" },
  { header: "x-cache", name: "edge/CDN cache" },
  { header: "x-cache-enabled", name: "host page cache" },
  { header: "x-proxy-cache", name: "proxy cache" },
  { header: "x-kinsta-cache", name: "Kinsta cache" },
  { header: "x-ac", name: "Pressable/edge cache" },
];

async function activePluginSlugs(target: Target): Promise<string[]> {
  try {
    const r = await target.wpCli([
      "plugin",
      "list",
      "--status=active",
      "--field=name",
      "--format=json",
    ]);
    if (r.exitCode !== 0) return [];
    const parsed = JSON.parse(r.stdout || "[]");
    return Array.isArray(parsed) ? parsed.map((s) => String(s)) : [];
  } catch {
    return [];
  }
}

async function isMultisite(target: Target): Promise<boolean> {
  try {
    const r = await target.wpCli(["core", "is-installed", "--network"]);
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/** Best-effort homepage header probe. A blocked fetch (WAF/staging auth) just
 *  means we under-report the host layer — the blanket caveat covers it. */
async function hostLayerFromHeaders(siteurl: string): Promise<CacheLayer[]> {
  const layers: CacheLayer[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(siteurl, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
    });
    clearTimeout(t);
    for (const sig of HOST_HEADER_SIGNALS) {
      if (res.headers.has(sig.header)) {
        layers.push({
          name: sig.name,
          kind: "host",
          detected: true,
          purgeable: false,
          manual_required: true,
          note: `saw header "${sig.header}: ${res.headers.get(sig.header)}" — purge at the host/CDN panel`,
        });
      }
    }
  } catch {
    /* best-effort — blanket caveat carries the uncertainty */
  }
  return layers;
}

export async function detectCacheLayers(
  target: Target,
): Promise<CacheLayersReport> {
  const [slugs, multisite, hostLayers] = await Promise.all([
    activePluginSlugs(target),
    isMultisite(target),
    hostLayerFromHeaders(target.siteurl),
  ]);

  const layers: CacheLayer[] = [];

  // Object cache layer — flushed by op=flush_object, NOT part of page purge.
  try {
    const ct = await target.wpCli(["cache", "type"]);
    const active = ct.exitCode === 0 && !/^Default/i.test(ct.stdout.trim());
    if (active) {
      layers.push({
        name: `object cache (${ct.stdout.trim()})`,
        kind: "object",
        detected: true,
        purgeable: false,
        manual_required: false,
        note: "clear with op=flush_object — the OBJECT cache is separate from the page cache",
      });
    }
  } catch {
    /* ignore */
  }

  for (const p of PAGE_CACHE_PURGEABLE) {
    if (slugs.some((s) => p.slug.test(s))) {
      layers.push({
        name: p.name,
        kind: "plugin",
        detected: true,
        purgeable: true,
        purge_argv: p.purge_argv,
        manual_required: false,
      });
    }
  }
  for (const p of PAGE_CACHE_MANUAL) {
    if (slugs.some((s) => p.slug.test(s))) {
      layers.push({
        name: p.name,
        kind: "plugin",
        detected: true,
        purgeable: false,
        manual_required: true,
        note: "no reliable wp-cli purge — clear from the plugin's settings screen",
      });
    }
  }

  layers.push(...hostLayers);

  return { layers, caveat: BLANKET_CAVEAT, multisite };
}

export interface PagePurgeResult {
  purged: string[];
  manual_required: string[];
  failed: Array<{ name: string; detail: string }>;
  caveat: string;
}

/**
 * Purge every page-cache layer we have a verified command for. The OBJECT cache
 * is deliberately excluded (that's op=flush_object). Host/CDN + unknown-plugin
 * layers are returned as manual_required, never silently skipped.
 */
export async function purgePageCache(
  target: Target,
  report: CacheLayersReport,
): Promise<PagePurgeResult> {
  const purged: string[] = [];
  const manual_required: string[] = [];
  const failed: Array<{ name: string; detail: string }> = [];

  for (const layer of report.layers) {
    if (layer.kind === "object") continue; // not a page layer
    if (layer.purgeable && layer.purge_argv) {
      const r = await target.wpCli(layer.purge_argv, {
        allowDestructive: true,
      });
      // A non-zero exit means it did NOT purge — report honestly.
      if (r.exitCode === 0) purged.push(layer.name);
      else
        failed.push({
          name: layer.name,
          detail: (r.stderr || `exit ${r.exitCode}`).slice(0, 200),
        });
    } else if (layer.manual_required) {
      manual_required.push(layer.name);
    }
  }

  return { purged, manual_required, failed, caveat: report.caveat };
}
