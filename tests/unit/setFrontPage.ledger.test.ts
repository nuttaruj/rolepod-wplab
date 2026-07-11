import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

const executePhp = vi.fn();
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => ({ executePhp }),
}));

const { wpSetFrontPageHandler } =
  await import("../../src/tools/atomic/wp_set_front_page.js");
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const target = {
  id: "tgt_frontpage",
  kind: "rest",
  siteurl: "https://x.test",
  companion: { enabled: true },
} as const;
const registry = { get: () => target } as unknown as TargetRegistry;

beforeEach(() => {
  recordChange.mockClear();
  executePhp.mockReset();
});

function phpReturns(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
) {
  executePhp.mockResolvedValue({
    ok: true,
    return_value: { ...current, previous },
  });
}

describe("wp_set_front_page — one ledger row per option", () => {
  it("records show_on_front + page_on_front with real option names", async () => {
    phpReturns(
      { show_on_front: "posts", page_on_front: 0, page_for_posts: 0 },
      { show_on_front: "page", page_on_front: 12, page_for_posts: 0 },
    );
    await wpSetFrontPageHandler(registry, {
      target_id: "tgt_frontpage",
      front_page_id: 12,
    });

    expect(recordChange).toHaveBeenCalledTimes(2);
    const subs = recordChange.mock.calls.map((c) => c[1].subcategory);
    expect(subs).toEqual(["show_on_front", "page_on_front"]);
    // Never the junk key the old code used.
    expect(subs).not.toContain("front-page");
  });

  it("captures before/after as {value} so the option dispatcher can revert", async () => {
    phpReturns(
      { show_on_front: "posts", page_on_front: 0, page_for_posts: 0 },
      { show_on_front: "page", page_on_front: 12, page_for_posts: 0 },
    );
    await wpSetFrontPageHandler(registry, {
      target_id: "tgt_frontpage",
      front_page_id: 12,
    });
    const front = recordChange.mock.calls.find(
      (c) => c[1].subcategory === "page_on_front",
    )![1];
    expect(front).toMatchObject({
      category: "option",
      beforeState: { value: 0 },
      afterState: { value: 12 },
      reversible: true,
    });
  });

  it("records page_for_posts only when it was set", async () => {
    phpReturns(
      { show_on_front: "posts", page_on_front: 0, page_for_posts: 0 },
      { show_on_front: "page", page_on_front: 12, page_for_posts: 8 },
    );
    await wpSetFrontPageHandler(registry, {
      target_id: "tgt_frontpage",
      front_page_id: 12,
      posts_page_id: 8,
    });
    const subs = recordChange.mock.calls.map((c) => c[1].subcategory);
    expect(subs).toEqual(["show_on_front", "page_on_front", "page_for_posts"]);
  });
});
