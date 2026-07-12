import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpTermHandler } = await import("../../src/tools/atomic/wp_term.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function shellTarget(wpCli: ReturnType<typeof vi.fn>) {
  return {
    id: "tgt_term0001",
    kind: "local",
    siteurl: "https://x.test",
    wpCli,
  };
}
function restTarget(rest: ReturnType<typeof vi.fn>) {
  return {
    id: "tgt_term0001",
    kind: "rest",
    siteurl: "https://x.test",
    companion: { enabled: true },
    rest,
  };
}
function reg(t: unknown): TargetRegistry {
  return { get: () => t } as unknown as TargetRegistry;
}

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

describe("wp_term — wp-cli branch", () => {
  it("ensure returns the existing term (existed:true) without creating", async () => {
    const wpCli = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ term_id: 12, slug: "news", name: "News" }]),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "99", stderr: "" };
    });
    const out = await wpTermHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_term0001",
      action: "ensure",
      taxonomy: "category",
      slug: "news",
    });
    expect(out).toMatchObject({ existed: true, term_id: 12, source: "wp_cli" });
    // no `term create` call
    expect(wpCli.mock.calls.some((c) => c[0][1] === "create")).toBe(false);
  });

  it("ensure creates when not found (porcelain id)", async () => {
    const wpCli = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "list") return { exitCode: 0, stdout: "[]", stderr: "" };
      return { exitCode: 0, stdout: "77\n", stderr: "" };
    });
    const out = await wpTermHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_term0001",
      action: "ensure",
      taxonomy: "category",
      name: "Fresh",
      slug: "fresh",
    });
    expect(out).toMatchObject({ existed: false, term_id: 77 });
    expect(
      wpCli.mock.calls.some(
        (c) => c[0][1] === "create" && c[0].includes("--porcelain"),
      ),
    ).toBe(true);
  });
});

describe("wp_term — REST branch", () => {
  it("maps category → categories and creates", async () => {
    const rest = vi.fn(async (req: { method: string; path: string }) => {
      if (req.method === "POST")
        return { status: 201, body: { id: 5 }, headers: {} };
      return { status: 200, body: [], headers: {} };
    });
    const out = await wpTermHandler(reg(restTarget(rest)), guard, {
      target_id: "tgt_term0001",
      action: "create",
      taxonomy: "category",
      name: "Blog",
    });
    expect(out).toMatchObject({ term_id: 5, source: "rest" });
    expect(
      rest.mock.calls.some(
        (c) => c[0].method === "POST" && c[0].path === "/wp/v2/categories",
      ),
    ).toBe(true);
  });
});

describe("wp_term — production gate", () => {
  it("blocks a create on a prod target without confirm", async () => {
    const wpCli = vi.fn();
    await expect(
      wpTermHandler(
        reg({ ...shellTarget(wpCli), siteurl: "https://prod.test" }),
        new ProdGuard(["prod.test"]),
        {
          target_id: "tgt_term0001",
          action: "create",
          taxonomy: "category",
          name: "X",
        },
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });
  });
});
