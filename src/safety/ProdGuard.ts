import { ProductionBlockedError } from "../util/errors.js";

/**
 * Production-host matcher. Patterns are glob-like with `*` wildcards.
 *
 *   "mysite.com"     → matches exactly mysite.com (any port)
 *   "*.mysite.com"   → matches subdomains
 *   "client-*"       → matches client-anything
 */
export class ProdGuard {
  private readonly patterns: RegExp[];
  /** Hosts the site itself reported as production, added at connect time. */
  private readonly markedHosts = new Set<string>();
  /**
   * Hosts whose companion reported guarded mode (full-access toggle OFF).
   * Armed regardless of any production signal — the owner chose the safe
   * subset, so the client blocks its risky tools with a clear error instead
   * of letting each call travel to the server just to collect a 403.
   */
  private readonly guardedHosts = new Set<string>();
  /**
   * Hosts whose owner enabled full access on the companion. Outranks every
   * detection signal: the toggle is the owner's decision, and second-guessing
   * it would only divert writes onto ledger-less paths like execute-php.
   */
  private readonly fullAccessHosts = new Set<string>();

  constructor(patterns: readonly string[]) {
    this.patterns = patterns.map(globToRegex);
  }

  /**
   * Arm the guard for a host the site declared production, so a target the
   * operator never listed in ROLEPOD_WPLAB_PROD_HOSTS is still protected.
   *
   * Folded into `matches()` rather than checked separately, so every existing
   * call site picks it up without change. Returns false when `siteurl` has no
   * parseable host.
   */
  markProduction(siteurl: string): boolean {
    const host = hostOf(siteurl);
    if (!host) return false;
    this.markedHosts.add(host);
    return true;
  }

  /** Arm the guard because the companion reported guarded mode. */
  armGuarded(siteurl: string): boolean {
    const host = hostOf(siteurl);
    if (!host) return false;
    this.guardedHosts.add(host);
    this.fullAccessHosts.delete(host);
    return true;
  }

  /** Disarm the guard because the owner enabled full access. */
  disarm(siteurl: string): boolean {
    const host = hostOf(siteurl);
    if (!host) return false;
    this.fullAccessHosts.add(host);
    this.guardedHosts.delete(host);
    return true;
  }

  /** True when a write to `siteurl` would need an explicit confirm. */
  isArmedFor(siteurl: string): boolean {
    return this.matches(siteurl).matched;
  }

  matches(
    siteurl: string,
  ): { matched: false } | { matched: true; pattern: string } {
    const host = hostOf(siteurl);
    if (!host) return { matched: false };

    if (this.fullAccessHosts.has(host)) return { matched: false };
    if (this.guardedHosts.has(host)) {
      return {
        matched: true,
        pattern: `${host} (guarded mode — enable Full access in wp-admin → Rolepod WP → Settings)`,
      };
    }

    if (this.markedHosts.has(host)) {
      return { matched: true, pattern: `${host} (WP_ENVIRONMENT_TYPE)` };
    }
    for (let i = 0; i < this.patterns.length; i++) {
      const re = this.patterns[i]!;
      if (re.test(host)) {
        const srcPattern = re.source
          .replace(/^\^/, "")
          .replace(/\$$/, "")
          .replace(/\\\./g, ".")
          .replace(/\.\*/g, "*");
        return { matched: true, pattern: srcPattern };
      }
    }
    return { matched: false };
  }

  enforce(siteurl: string): void {
    const result = this.matches(siteurl);
    if (result.matched) {
      throw new ProductionBlockedError(siteurl, result.pattern);
    }
  }

  static fromEnv(): ProdGuard {
    const raw = process.env["ROLEPOD_WPLAB_PROD_HOSTS"] ?? "";
    const patterns = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return new ProdGuard(patterns);
  }
}

function hostOf(siteurl: string): string | null {
  try {
    return new URL(siteurl).hostname;
  } catch {
    return null;
  }
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
