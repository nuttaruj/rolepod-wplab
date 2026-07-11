import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

const { writeScalarMeta } =
  await import("../../src/adapters/_shared/writeScalarMeta.js");
import type { Target } from "../../src/runtime/Target.js";

/** `post meta get` → prior; `post meta update` → exit 0 unless updateFails. */
function fakeTarget(prior: string | null, updateFails = false) {
  const wpCli = vi.fn(async (args: readonly string[]) => {
    if (args[1] === "meta" && args[2] === "get") {
      return prior === null
        ? { exitCode: 0, stdout: "", stderr: "", durationMs: 1 }
        : { exitCode: 0, stdout: `${prior}\n`, stderr: "", durationMs: 1 };
    }
    return updateFails
      ? { exitCode: 1, stdout: "", stderr: "boom", durationMs: 1 }
      : { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  return { id: "tgt_scalar01", kind: "local", wpCli } as unknown as Target;
}

beforeEach(() => recordChange.mockClear());

describe("writeScalarMeta", () => {
  it("records a reversible row when the key had a prior value", async () => {
    const res = await writeScalarMeta(
      fakeTarget("old title"),
      7,
      "_yoast_wpseo_title",
      "new title",
      "rolepod_wp_yoast_write",
    );
    expect(res).toMatchObject({ updated: true, reversible: true });
    expect(recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        category: "post",
        subcategory: "_yoast_wpseo_title",
        beforeState: { value: "old title" },
        afterState: { value: "new title" },
        reversible: true,
      }),
    );
  });

  it("records a NON-reversible row when the key was absent, with a delete note", async () => {
    const res = await writeScalarMeta(
      fakeTarget(null),
      7,
      "rank_math_title",
      "x",
      "rolepod_wp_rankmath_write",
    );
    expect(res.reversible).toBe(false);
    const row = recordChange.mock.calls[0]![1];
    expect(row).toMatchObject({
      reversible: false,
      beforeState: { value: null },
    });
    expect(row.notes).toMatch(/wp post meta delete 7 rank_math_title/);
  });

  it("throws and records nothing when the write fails", async () => {
    await expect(
      writeScalarMeta(
        fakeTarget("old", true),
        7,
        "k",
        "v",
        "rolepod_wp_yoast_write",
      ),
    ).rejects.toThrow(/post meta update k failed/);
    expect(recordChange).not.toHaveBeenCalled();
  });
});
