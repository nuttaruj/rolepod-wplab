import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

let capturedPayload = "";
let nextReturn: Record<string, unknown> = {};
const bridge = {
  executePhp: vi.fn(async (payload: string) => {
    capturedPayload = payload;
    return { ok: true, return_value: nextReturn };
  }),
};
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => bridge,
}));

const { wpRedirectSetHandler } =
  await import("../../src/tools/composite/wp_redirect_set.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function reg(siteurl = "https://x.test"): TargetRegistry {
  const target = {
    id: "tgt_rdr00001",
    kind: "rest",
    siteurl,
    companion: { enabled: true },
  };
  return { get: () => target } as unknown as TargetRegistry;
}
const guard = new ProdGuard([]);
beforeEach(() => {
  vi.clearAllMocks();
  capturedPayload = "";
  nextReturn = {};
});

describe("wp_redirect_set", () => {
  it("writes a Rank Math redirect via the plugin API (not a raw table insert)", async () => {
    nextReturn = {
      backend: "rankmath",
      created: true,
      id: 42,
      source: "/old",
      target: "/new",
      code: 301,
    };
    const out = await wpRedirectSetHandler(reg(), guard, {
      target_id: "tgt_rdr00001",
      source: "/old",
      target: "/new",
    });
    expect(out).toMatchObject({ backend: "rankmath", created: true, id: 42 });
    // Uses the plugin's own API + safe JSON arg embedding + multisite guard.
    expect(capturedPayload).toContain("RankMath");
    expect(capturedPayload).toContain("DB::add");
    expect(capturedPayload).toContain("json_decode");
    expect(capturedPayload).toContain("MULTISITE_UNSUPPORTED");
  });

  it("surfaces REDIRECT_BACKEND_MANUAL when only the Redirection plugin is active", async () => {
    nextReturn = {
      error: "REDIRECT_BACKEND_MANUAL",
      detail: "use Tools > Redirection",
    };
    await expect(
      wpRedirectSetHandler(reg(), guard, {
        target_id: "tgt_rdr00001",
        source: "/a",
        target: "/b",
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_BACKEND_MANUAL" });
  });

  it("surfaces REDIRECT_BACKEND_MISSING when no backend is present", async () => {
    nextReturn = {
      error: "REDIRECT_BACKEND_MISSING",
      detail: "install Rank Math",
    };
    await expect(
      wpRedirectSetHandler(reg(), guard, {
        target_id: "tgt_rdr00001",
        source: "/a",
        target: "/b",
      }),
    ).rejects.toMatchObject({ code: "REDIRECT_BACKEND_MISSING" });
  });

  it("blocks a prod target without confirm", async () => {
    await expect(
      wpRedirectSetHandler(
        reg("https://prod.test"),
        new ProdGuard(["prod.test"]),
        {
          target_id: "tgt_rdr00001",
          source: "/a",
          target: "/b",
        },
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });
    expect(bridge.executePhp).not.toHaveBeenCalled();
  });
});
