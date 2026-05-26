/**
 * Cross-component contract between rolepod-wplab (Node MCP) and
 * rolepod-wp (PHP WordPress plugin — the WP arm of the Rolepod ecosystem).
 *
 * These constants are the entire reason the two repos can ship independently:
 * MCP discovers the plugin via INSTALL_URL, the plugin declares its capability
 * surface via the Pair response, and MIN_VERSION lets MCP refuse a too-old
 * plugin before it fails opaquely deeper in the stack.
 *
 * Plugin renamed from `rolepod-wplab-companion` → `rolepod-wp` at companion
 * v2.0.0 (clean break — no in-place upgrade path). REST namespace stays
 * `wplab/v1` for wire compatibility.
 */

export const COMPANION_PLUGIN_SLUG = "rolepod-wp";

export const COMPANION_REPO_URL = "https://github.com/nuttaruj/rolepod-wp";

/**
 * Stable URL — points at `releases/latest/download/` so it never needs to
 * change when the plugin bumps versions. The companion release workflow emits
 * the zip without a version suffix in the filename for exactly this reason.
 */
export const COMPANION_INSTALL_URL = `${COMPANION_REPO_URL}/releases/latest/download/${COMPANION_PLUGIN_SLUG}.zip`;

/**
 * Floor companion version this MCP build is known to work with. Bumped when
 * MCP starts depending on a new Pair / endpoint capability. MCP warns (does
 * not throw) when an older companion is detected, since most operations
 * degrade gracefully into default-safe mode.
 *
 * 2.0.0 — companion repo + plugin slug renamed to rolepod-wp. Earlier 1.x
 * installs still respond on `/wplab/v1/*` endpoints, but the install URL +
 * directory layout changed; the warning below catches that drift.
 */
export const MIN_COMPANION_VERSION = "2.0.0";

/**
 * Build the wp-admin URL of the setup wizard for a given site. Used in
 * Path-2 "no creds yet" guidance and in connect failures so the AI agent
 * can hand the user a deep link instead of asking them to hunt menus.
 */
export function setupWizardUrlFor(siteurl: string): string {
  return `${siteurl.replace(/\/$/, "")}/wp-admin/tools.php?page=rolepod-wp-setup`;
}

/**
 * Compare two dotted semver-ish versions ("1.2.0" vs "1.2.3"). Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b. Non-numeric segments compare
 *  lexicographically — sufficient for our 0.x / 1.x release pattern.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = Number.parseInt(pa[i] ?? "0", 10);
    const nb = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
      const sa = pa[i] ?? "";
      const sb = pb[i] ?? "";
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      continue;
    }
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

export function isCompanionTooOld(version: string | undefined): boolean {
  if (!version || version === "unknown") return false;
  return compareVersions(version, MIN_COMPANION_VERSION) < 0;
}
