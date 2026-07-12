import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));
// Oxygen adapter detect + write are stubbed so the test exercises only the
// honesty note logic in the handler.
vi.mock("../../src/adapters/oxygen/read.js", () => ({
  oxygenAdapter: { detect: vi.fn(async () => true) },
}));
vi.mock("../../src/adapters/oxygen/write.js", () => ({
  oxygenWrite: {
    updatePageShortcodes: vi.fn(async () => ({
      bytesWritten: 42,
      backupPath: null,
    })),
  },
}));

const { wpOxygenWriteHandler } =
  await import("../../src/tools/adapter/wp_oxygen_write.js");
const { formsWrite } = await import("../../src/adapters/forms/write.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { Target } from "../../src/runtime/Target.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

describe("WS12-T3 — oxygen_write ct_builder_json honesty", () => {
  function reg(ctBuilderJson: string) {
    const target = {
      id: "tgt_ox000001",
      kind: "local",
      siteurl: "https://x.test",
      wpCli: vi.fn(async (args: readonly string[]) => ({
        exitCode: 0,
        stdout: args.includes("ct_builder_json") ? ctBuilderJson : "",
        stderr: "",
        durationMs: 1,
      })),
    };
    return { get: () => target } as unknown as TargetRegistry;
  }

  it("LOUDLY warns when the page has a ct_builder_json tree", async () => {
    const out = await wpOxygenWriteHandler(reg('{"tree":1}'), guard, {
      target_id: "tgt_ox000001",
      post_id: 5,
      shortcodes: "[ct_section]",
      allow_destructive: true,
    });
    expect(out.ct_builder_json_present).toBe(true);
    expect(out.note).toMatch(/WARNING.*ct_builder_json/);
  });

  it("gives a softer sync reminder when no ct_builder_json is present", async () => {
    const out = await wpOxygenWriteHandler(reg(""), guard, {
      target_id: "tgt_ox000001",
      post_id: 5,
      shortcodes: "[ct_section]",
      allow_destructive: true,
    });
    expect(out.ct_builder_json_present).toBe(false);
    expect(out.note).toMatch(/ct_builder_shortcodes/);
  });
});

describe("WS14 — forms_write refuses unsupported engines loudly", () => {
  const shell = { kind: "local", companion: {} } as unknown as Target;

  it.each(["cf7", "wpforms"] as const)(
    "throws FORMS_ENGINE_UNSUPPORTED_WRITE for %s (delete_entry)",
    async (engine) => {
      await expect(
        formsWrite.deleteEntry(shell, engine, 1),
      ).rejects.toMatchObject({ code: "FORMS_ENGINE_UNSUPPORTED_WRITE" });
    },
  );

  it("mark_spam + unmark_spam also refuse non-Gravity engines", async () => {
    await expect(formsWrite.markSpam(shell, "cf7", 1)).rejects.toMatchObject({
      code: "FORMS_ENGINE_UNSUPPORTED_WRITE",
    });
    await expect(
      formsWrite.unmarkSpam(shell, "wpforms", 1),
    ).rejects.toMatchObject({ code: "FORMS_ENGINE_UNSUPPORTED_WRITE" });
  });
});
