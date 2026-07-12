import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

let capturedPayload = "";
const bridge = {
  executePhp: vi.fn(async (payload: string) => {
    capturedPayload = payload;
    return {
      ok: true,
      return_value: {
        plugin: "yoast",
        post_id: 12,
        set: { _yoast_wpseo_metadesc: "Hello" },
        before: {},
        indexable_rebuilt: true,
        desc_in_head: true,
        post_status: "publish",
      },
    };
  }),
};
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => bridge,
}));

const { wpSeoSetHandler } =
  await import("../../src/tools/atomic/wp_seo_set.js");
const { wpHealthCheckHandler } =
  await import("../../src/tools/atomic/wp_health_check.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const guard = new ProdGuard([]);
beforeEach(() => {
  vi.clearAllMocks();
  capturedPayload = "";
});

describe("wp_seo_set — G7 indexable rebuild + rendered-head verify (WS5-T1/T2)", () => {
  it("deletes the yoast_indexable row and self-fetches to verify", async () => {
    const target = {
      id: "tgt_seo00001",
      kind: "rest",
      siteurl: "https://x.test",
      companion: { enabled: true },
    };
    const registry = { get: () => target } as unknown as TargetRegistry;
    const rv = (await wpSeoSetHandler(registry, {
      target_id: "tgt_seo00001",
      post_id: 12,
      meta_description: "Hello",
    })) as { indexable_rebuilt?: boolean; desc_in_head?: boolean };

    // The payload invalidates the Yoast indexable cache + verifies via the head.
    expect(capturedPayload).toContain("yoast_indexable");
    expect(capturedPayload).toContain("$wpdb->delete");
    expect(capturedPayload).toContain("wp_remote_get");
    // Surfaced back to the caller.
    expect(rv.indexable_rebuilt).toBe(true);
    expect(rv.desc_in_head).toBe(true);
  });
});

describe("wp_health_check — blog_public noindex probe (WS5-T5)", () => {
  function target(blogPublic: string) {
    return {
      id: "tgt_hc000001",
      kind: "local",
      siteurl: "https://x.test",
      wpVersion: "6.4.1",
      companion: { enabled: false },
      wpCli: vi.fn(async (args: readonly string[]) => {
        if (args[1] === "get" && args[2] === "blog_public")
          return { exitCode: 0, stdout: blogPublic, stderr: "", durationMs: 1 };
        // siteurl / anything else
        return {
          exitCode: 0,
          stdout: "https://x.test",
          stderr: "",
          durationMs: 1,
        };
      }),
      rest: vi.fn(async () => ({ status: 200, body: {}, headers: {} })),
    };
  }

  it("warns when blog_public=0 (site is noindex)", async () => {
    const registry = {
      get: () => target("0"),
    } as unknown as TargetRegistry;
    const out = await wpHealthCheckHandler(registry, guard, {
      target_id: "tgt_hc000001",
    });
    expect(out.warnings.some((w) => /NOINDEX/.test(w))).toBe(true);
  });

  it("does not warn when blog_public=1", async () => {
    const registry = {
      get: () => target("1"),
    } as unknown as TargetRegistry;
    const out = await wpHealthCheckHandler(registry, guard, {
      target_id: "tgt_hc000001",
    });
    expect(out.warnings.some((w) => /NOINDEX/.test(w))).toBe(false);
  });
});
