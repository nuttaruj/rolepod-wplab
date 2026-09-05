import { describe, expect, it, vi } from "vitest";
import { wpRestDumpHandler } from "../../src/tools/atomic/wp_rest_dump.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

/**
 * Measured on a plugin-heavy production site (2026-09-06): 371 routes across
 * 18 namespaces — ~56 KB pretty-printed as a table, ~1 KB as counts. The
 * default is the counts; the table comes on request.
 */

const INDEX = {
  namespaces: ["wp/v2", "wc/v3", "yoast/v1"],
  routes: {
    "/wp/v2": { namespace: "wp/v2", methods: ["GET"] },
    "/wp/v2/posts": { namespace: "wp/v2", methods: ["GET", "POST"] },
    "/wp/v2/pages": { namespace: "wp/v2", methods: ["GET", "POST"] },
    "/wc/v3/orders": { namespace: "wc/v3", methods: ["GET", "POST"] },
    "/yoast/v1/meta": { namespace: "yoast/v1", methods: ["GET"] },
  },
};

function registry() {
  const rest = vi.fn(async () => ({ status: 200, body: INDEX }));
  return {
    get: () => ({ id: "tgt_rd000001", kind: "rest", rest }),
  } as unknown as TargetRegistry;
}

describe("wpRestDumpHandler — summary first (brief 14)", () => {
  it("returns per-namespace counts and no route table by default", async () => {
    const out = await wpRestDumpHandler(registry(), {
      target_id: "tgt_rd000001",
    });
    expect(out.namespaces).toEqual(["wp/v2", "wc/v3", "yoast/v1"]);
    expect(out.route_count).toBe(5);
    expect(out.routes_by_namespace).toEqual({
      "wp/v2": 3,
      "wc/v3": 1,
      "yoast/v1": 1,
    });
    expect(out.routes).toBeUndefined();
  });

  it("filter_namespace returns that namespace's table", async () => {
    const out = await wpRestDumpHandler(registry(), {
      target_id: "tgt_rd000001",
      filter_namespace: "wc/v3",
    });
    expect(out.namespaces).toEqual(["wc/v3"]);
    expect(out.route_count).toBe(1);
    expect(out.routes_by_namespace).toEqual({ "wc/v3": 1 });
    expect(out.routes).toEqual([
      { path: "/wc/v3/orders", namespace: "wc/v3", methods: ["GET", "POST"] },
    ]);
  });

  it("full=true returns every route", async () => {
    const out = await wpRestDumpHandler(registry(), {
      target_id: "tgt_rd000001",
      full: true,
    });
    expect(out.routes).toHaveLength(5);
    expect(out.route_count).toBe(5);
  });
});
