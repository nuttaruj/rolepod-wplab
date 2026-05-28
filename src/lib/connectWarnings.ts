/**
 * Connect-time warnings.
 *
 * After a successful target open, scan the live target for non-fatal but
 * load-bearing config issues that would silently break common workflows.
 * Each detector returns either null (clean) or a warning object that
 * surfaces in `connect_rest` output under `warnings: []`.
 *
 * Detectors run best-effort — any internal failure is swallowed and logged
 * at debug level (the connect itself should not fail because a warning
 * detector threw).
 */
import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";

export interface ConnectWarning {
  code: string;
  message: string;
  suggested_fix?: string;
}

/**
 * Run every connect-time warning detector against a freshly opened target.
 * Returns the warnings that fired. Failures are absorbed.
 */
export async function collectConnectWarnings(
  target: Target,
  requestedUrl: string,
): Promise<ConnectWarning[]> {
  const out: ConnectWarning[] = [];

  for (const detector of DETECTORS) {
    try {
      const w = await detector(target, requestedUrl);
      if (w) out.push(w);
    } catch (err) {
      log.debug("connect warning detector threw", {
        detector: detector.name,
        err: (err as Error).message,
      });
    }
  }

  return out;
}

type Detector = (
  target: Target,
  requestedUrl: string,
) => Promise<ConnectWarning | null>;

const DETECTORS: Detector[] = [siteurlSchemeMismatch, blockThemeBodyOpen];

/**
 * Detect http://siteurl on a site that actually serves https://.
 *
 * Why this matters: Elementor (and many plugins) build asset URLs from the
 * `siteurl` option. If `siteurl` is http but the page is served over https,
 * the browser blocks the http stylesheet/script as mixed content → page
 * styles silently break. The WalnutZtudio build hit this on a fresh
 * Hostinger install.
 *
 * Detection: compare the URL the user passed to connect_rest (which we
 * verified TLS works on) against the `siteurl` option stored in WP. If
 * connect URL is https but stored siteurl is http → warn.
 */
/**
 * Detect block (FSE) themes where the active theme template doesn't call
 * `wp_body_open()`. Themes that rely on `wp_body_open` to inject decorative
 * markup (ambient layers, overlays, analytics pixels) will silently fail
 * because FSE templates render via `render_block()` and skip the classic
 * template tag.
 *
 * Detection: hit the WP themes REST endpoint, find the active theme, look
 * up its `is_block_theme` flag (added in WP 5.9). When true, warn.
 *
 * Note: not every block theme is broken — those that opt-in via
 * `add_theme_support('wp-body-open')` or include a body-open block in
 * their root template DO fire the hook. We surface a warning either way
 * because in practice the common case is "FSE theme + missing hook =
 * silent breakage" (Hello Elementor classic theme doesn't have this
 * issue, but TwentyTwentyFive does).
 */
async function blockThemeBodyOpen(
  target: Target,
): Promise<ConnectWarning | null> {
  try {
    const r = await target.rest({
      method: "GET",
      path: "/wp/v2/themes?status=active",
    });
    if (r.status !== 200 || !Array.isArray(r.body)) return null;
    const themes = r.body as Array<Record<string, unknown>>;
    const active = themes[0];
    if (!active) return null;
    const isBlock = !!active["is_block_theme"];
    if (!isBlock) return null;
    const slug = typeof active["stylesheet"] === "string" ? (active["stylesheet"] as string) : "the active theme";
    return {
      code: "block_theme_body_open_risk",
      message: `Active theme "${slug}" is a block (FSE) theme. wp_body_open() may not fire from FSE templates — anything injected via the wp_body_open hook (ambient layers, pixels, overlays) can silently fail to render.`,
      suggested_fix:
        "Either (a) switch to a classic parent theme (Hello Elementor is the standard for Elementor builds), or (b) ensure the theme's root template renders a {{wp:body-open}} block / calls wp_body_open() explicitly, or (c) inject via the_content / wp_footer instead.",
    };
  } catch (err) {
    log.debug("blockThemeBodyOpen detector skipped", { err: (err as Error).message });
    return null;
  }
}

async function siteurlSchemeMismatch(
  target: Target,
  requestedUrl: string,
): Promise<ConnectWarning | null> {
  if (!requestedUrl.startsWith("https://")) return null;

  // Read siteurl + home via REST settings endpoint (avoids needing companion).
  try {
    const r = await target.rest({
      method: "GET",
      path: "/wp/v2/settings",
    });
    if (r.status !== 200 || !r.body || typeof r.body !== "object") return null;
    const body = r.body as Record<string, unknown>;
    const siteUrlStored = typeof body["url"] === "string" ? body["url"] : null;
    if (!siteUrlStored) return null;
    if (!siteUrlStored.startsWith("http://")) return null;
    const hostMatch =
      new URL(requestedUrl).host.toLowerCase() ===
      new URL(siteUrlStored).host.toLowerCase();
    if (!hostMatch) return null;

    return {
      code: "siteurl_http_but_site_https",
      message: `WP stores siteurl as ${siteUrlStored} but the site is reachable over https. Plugin-generated asset URLs (Elementor, etc) will be blocked as mixed content.`,
      suggested_fix: `Run: wp option update siteurl ${requestedUrl.replace(/\/$/, "")} && wp option update home ${requestedUrl.replace(/\/$/, "")} && wp elementor flush-css`,
    };
  } catch (err) {
    log.debug("siteurlSchemeMismatch detector skipped", {
      err: (err as Error).message,
    });
    return null;
  }
}
