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

  /** True when a write to `siteurl` would need an explicit confirm. */
  isArmedFor(siteurl: string): boolean {
    return this.matches(siteurl).matched;
  }

  matches(
    siteurl: string,
  ): { matched: false } | { matched: true; pattern: string } {
    const host = hostOf(siteurl);
    if (!host) return { matched: false };

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
