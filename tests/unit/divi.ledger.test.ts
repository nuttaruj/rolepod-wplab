import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

const { diviWrite } = await import("../../src/adapters/divi/write.js");
import type { Target } from "../../src/runtime/Target.js";

/** post get → prior content; fileWrite/post update → ok. */
function fakeTarget(priorContent: string | null) {
  const wpCli = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "post" && args[1] === "get") {
      return priorContent === null
        ? { exitCode: 1, stdout: "", stderr: "", durationMs: 1 }
        : { exitCode: 0, stdout: priorContent, stderr: "", durationMs: 1 };
    }
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  const fileWrite = vi.fn(async (path: string) => ({
    bytesWritten: 1,
    backupPath: null,
    absolutePath: `/srv/${path}`,
  }));
  return {
    id: "tgt_divi0001",
    kind: "local",
    siteurl: "https://x.test",
    companion: null,
    wpCli,
    fileWrite,
  } as unknown as Target;
}

beforeEach(() => recordChange.mockClear());

describe("divi write — ledger coverage (bypasses replacePostMeta)", () => {
  it("records a reversible post_content row with before/after", async () => {
    await diviWrite.updatePageContent(
      fakeTarget("[et_pb_section]old[/et_pb_section]"),
      7,
      "[et_pb_section]new[/et_pb_section]",
    );
    expect(recordChange).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        category: "post",
        subcategory: "post_content",
        beforeState: { post_content: "[et_pb_section]old[/et_pb_section]" },
        afterState: { post_content: "[et_pb_section]new[/et_pb_section]" },
        reversible: true,
        sourceTool: "rolepod_wp_divi_write",
      }),
    );
  });

  it("does not record when the prior content could not be read", async () => {
    await diviWrite.updatePageContent(
      fakeTarget(null),
      7,
      "[et_pb_section][/et_pb_section]",
    );
    expect(recordChange).not.toHaveBeenCalled();
  });
});
