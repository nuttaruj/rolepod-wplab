import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpPodsWriteHandler } =
  await import("../../src/tools/adapter/wp_pods_write.js");
const { verifyRestMeta } =
  await import("../../src/adapters/_shared/verifyRestMeta.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { Target } from "../../src/runtime/Target.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

/** rest mock: GET returns the given meta on read-back; POST always 200. */
function target(readBackMeta: Record<string, unknown>) {
  return {
    id: "tgt_fp000001",
    kind: "rest",
    siteurl: "https://x.test",
    companion: { enabled: true },
    rest: vi.fn(async (req: { method: string }) => {
      if (req.method === "GET")
        return { status: 200, body: { meta: readBackMeta }, headers: {} };
      return { status: 200, body: { id: 5 }, headers: {} };
    }),
  } as unknown as Target;
}

describe("verifyRestMeta — read-back detection of silent no-op writes", () => {
  it("verified=true when the value persists", async () => {
    const t = target({ tagline: "hi" });
    const r = await verifyRestMeta(t, 5, { tagline: "hi" });
    expect(r).toMatchObject({ verified: true, mismatched: [] });
  });

  it("verified=false + note when a field did NOT change (custom-table storage)", async () => {
    const t = target({}); // read-back shows the key never landed
    const r = await verifyRestMeta(t, 5, { custom_field: "value" });
    expect(r.verified).toBe(false);
    expect(r.mismatched).toContain("custom_field");
    expect(r.note).toMatch(/did not change|non-standard storage/);
  });
});

describe("pods_write — honest verified flag", () => {
  it("returns verified=false + unverified_fields when the write no-ops", async () => {
    const registry = {
      get: () => target({}), // nothing persisted
    } as unknown as TargetRegistry;
    const out = (await wpPodsWriteHandler(registry, guard, {
      target_id: "tgt_fp000001",
      scope: "post_meta",
      post_id: 5,
      meta: { custom_table_field: "x" },
    })) as { ok: boolean; verified: boolean; unverified_fields?: string[] };
    expect(out.ok).toBe(false);
    expect(out.verified).toBe(false);
    expect(out.unverified_fields).toContain("custom_table_field");
  });

  it("returns verified=true when the value persists", async () => {
    const registry = {
      get: () => target({ real_meta_field: "x" }),
    } as unknown as TargetRegistry;
    const out = (await wpPodsWriteHandler(registry, guard, {
      target_id: "tgt_fp000001",
      scope: "post_meta",
      post_id: 5,
      meta: { real_meta_field: "x" },
    })) as { verified: boolean };
    expect(out.verified).toBe(true);
  });
});
