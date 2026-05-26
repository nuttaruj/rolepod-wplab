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

  constructor(patterns: readonly string[]) {
    this.patterns = patterns.map(globToRegex);
  }

  matches(
    siteurl: string,
  ): { matched: false } | { matched: true; pattern: string } {
    let host: string;
    try {
      host = new URL(siteurl).hostname;
    } catch {
      return { matched: false };
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

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
