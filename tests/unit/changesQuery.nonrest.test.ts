import { describe, expect, it, vi } from "vitest";

const bridgeFor = vi.fn();
vi.mock("../../src/companion/Bridge.js", () => ({ bridgeFor }));

const { wpChangesQueryHandler } =
  await import("../../src/tools/companion/wp_changes_query.js");
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function registryFor(kind: string): TargetRegistry {
  return {
    get: () => ({ id: "tgt_changes01", kind, siteurl: "https://x.test" }),
  } as unknown as TargetRegistry;
}

describe("changes_query — honest about non-companion targets", () => {
  it.each(["local", "ssh", "docker"])(
    "reports ledger_available:false on a %s target without touching the bridge",
    async (kind) => {
      const out = (await wpChangesQueryHandler(registryFor(kind), {
        target_id: "tgt_changes01",
      })) as { ledger_available: boolean; rows: unknown[]; note: string };

      expect(out.ledger_available).toBe(false);
      expect(out.rows).toEqual([]);
      expect(out.note).toMatch(new RegExp(kind));
      expect(bridgeFor).not.toHaveBeenCalled();
    },
  );

  it("goes through the bridge on a rest target", async () => {
    bridgeFor.mockResolvedValue({
      queryChanges: async () => ({ rows: [{ id: 1 }] }),
    });
    const out = (await wpChangesQueryHandler(registryFor("rest"), {
      target_id: "tgt_changes01",
    })) as { rows: unknown[] };
    expect(bridgeFor).toHaveBeenCalledOnce();
    expect(out.rows).toHaveLength(1);
  });
});
