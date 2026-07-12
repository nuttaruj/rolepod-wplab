import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectCacheLayers,
  purgePageCache,
} from "../../src/lib/cacheLayers.js";
import { checkWpCli } from "../../src/safety/AllowList.js";
import type { Target } from "../../src/runtime/Target.js";

function makeTarget(
  wpCli: ReturnType<typeof vi.fn>,
  siteurl = "https://x.test",
): Target {
  return { kind: "local", siteurl, wpCli } as unknown as Target;
}

/** wpCli mock that answers by leading args. */
function cliRouter(opts: {
  activePlugins?: string[];
  multisite?: boolean;
  objectCache?: string;
  purgeExit?: Record<string, number>;
}) {
  return vi.fn(async (args: readonly string[]) => {
    const key = args.join(" ");
    if (args[0] === "plugin" && args[1] === "list") {
      return {
        exitCode: 0,
        stdout: JSON.stringify(opts.activePlugins ?? []),
        stderr: "",
        durationMs: 1,
      };
    }
    if (key.startsWith("core is-installed")) {
      return {
        exitCode: opts.multisite ? 0 : 1,
        stdout: "",
        stderr: "",
        durationMs: 1,
      };
    }
    if (args[0] === "cache" && args[1] === "type") {
      return {
        exitCode: 0,
        stdout: opts.objectCache ?? "Default",
        stderr: "",
        durationMs: 1,
      };
    }
    // purge commands
    const exit = opts.purgeExit?.[args[0] ?? ""] ?? 0;
    return {
      exitCode: exit,
      stdout: "",
      stderr: exit ? "boom" : "",
      durationMs: 1,
    };
  });
}

beforeEach(() => {
  // Default: fetch fails (no host header) unless a test overrides it.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("network blocked");
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("cacheLayers — detect", () => {
  it("classifies purgeable plugins, manual plugins, and the object layer", async () => {
    const target = makeTarget(
      cliRouter({
        activePlugins: ["litespeed-cache", "wp-super-cache"],
        objectCache: "Redis",
      }),
    );
    const report = await detectCacheLayers(target);
    const byName = Object.fromEntries(report.layers.map((l) => [l.name, l]));
    expect(byName["LiteSpeed Cache"]).toMatchObject({
      kind: "plugin",
      purgeable: true,
      purge_argv: ["litespeed-purge", "all"],
    });
    expect(byName["WP Super Cache"]).toMatchObject({
      purgeable: false,
      manual_required: true,
    });
    // Object cache is present but is NOT a page layer (flush_object's job).
    expect(report.layers.some((l) => l.kind === "object")).toBe(true);
    expect(report.caveat).toMatch(/MISS/);
  });

  it("detects a host/CDN layer from a response header (best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        headers: {
          has: (h: string) => h === "cf-cache-status",
          get: () => "HIT",
        },
      })),
    );
    const target = makeTarget(cliRouter({ activePlugins: [] }));
    const report = await detectCacheLayers(target);
    const host = report.layers.find((l) => l.kind === "host");
    expect(host).toMatchObject({
      name: "Cloudflare",
      manual_required: true,
      purgeable: false,
    });
  });

  it("flags multisite", async () => {
    const target = makeTarget(cliRouter({ multisite: true }));
    const report = await detectCacheLayers(target);
    expect(report.multisite).toBe(true);
  });
});

describe("cacheLayers — purge", () => {
  it("purges purgeable plugins, excludes object, reports manual + failures honestly", async () => {
    const target = makeTarget(
      cliRouter({
        activePlugins: ["litespeed-cache", "wp-super-cache", "wp-rocket"],
        objectCache: "Redis",
        purgeExit: { rocket: 1 }, // rocket purge fails
      }),
    );
    const report = await detectCacheLayers(target);
    const result = await purgePageCache(target, report);
    expect(result.purged).toContain("LiteSpeed Cache");
    expect(result.manual_required).toContain("WP Super Cache");
    expect(result.failed.some((f) => f.name === "WP Rocket")).toBe(true);
    // Object cache never appears in a page purge.
    expect(result.purged).not.toContain("object cache (Redis)");
  });
});

describe("AllowList — WS6 purge heads", () => {
  it("allows verified purge commands only behind allow_destructive", () => {
    expect(checkWpCli(["litespeed-purge", "all"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
    expect(checkWpCli(["litespeed-purge", "all"], false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
    expect(checkWpCli(["w3-total-cache", "flush", "all"], true)).toMatchObject({
      allowed: true,
      kind: "destructive",
    });
  });
});
