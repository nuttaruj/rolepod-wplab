import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpUserWriteHandler } =
  await import("../../src/tools/atomic/wp_user_write.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function shellTarget(
  wpCli: ReturnType<typeof vi.fn>,
  siteurl = "https://x.test",
) {
  return { id: "tgt_user0001", kind: "local", siteurl, wpCli };
}
function restTarget(
  rest: ReturnType<typeof vi.fn>,
  siteurl = "https://x.test",
) {
  return {
    id: "tgt_user0001",
    kind: "rest",
    siteurl,
    companion: { enabled: true },
    rest,
  };
}
function reg(t: unknown): TargetRegistry {
  return { get: () => t } as unknown as TargetRegistry;
}

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

describe("wp_user_write — delete safety", () => {
  it("refuses a delete without reassign_to", async () => {
    const wpCli = vi.fn();
    await expect(
      wpUserWriteHandler(reg(shellTarget(wpCli)), guard, {
        target_id: "tgt_user0001",
        action: "delete",
        id: 5,
      }),
    ).rejects.toMatchObject({ code: "USER_DELETE_NEEDS_REASSIGN" });
    expect(wpCli).not.toHaveBeenCalled();
  });

  it("wp-cli delete passes --reassign and --yes", async () => {
    const wpCli = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const out = await wpUserWriteHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_user0001",
      action: "delete",
      id: 5,
      reassign_to: 1,
    });
    expect(out).toMatchObject({
      user_id: 5,
      reassigned_to: 1,
      source: "wp_cli",
    });
    expect(wpCli).toHaveBeenCalledWith(
      ["user", "delete", "5", "--reassign=1", "--yes"],
      { allowDestructive: true },
    );
  });

  it("REST delete sends force=true + reassign", async () => {
    const rest = vi.fn(async () => ({ status: 200, body: {}, headers: {} }));
    await wpUserWriteHandler(reg(restTarget(rest)), guard, {
      target_id: "tgt_user0001",
      action: "delete",
      id: 8,
      reassign_to: 2,
    });
    expect(rest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/wp/v2/users/8",
        query: { force: true, reassign: 2 },
      }),
    );
  });
});

describe("wp_user_write — create + prod gate", () => {
  it("wp-cli create returns porcelain id", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: "42\n",
      stderr: "",
    }));
    const out = await wpUserWriteHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_user0001",
      action: "create",
      username: "jane",
      email: "jane@x.test",
      role: "editor",
    });
    expect(out).toMatchObject({ user_id: 42, source: "wp_cli" });
    expect(wpCli.mock.calls[0]?.[0]).toEqual([
      "user",
      "create",
      "jane",
      "jane@x.test",
      "--porcelain",
      "--role=editor",
    ]);
  });

  it("blocks prod without confirm, proceeds with confirm", async () => {
    const wpCli = vi.fn(async () => ({ exitCode: 0, stdout: "9", stderr: "" }));
    const prod = new ProdGuard(["prod.test"]);
    await expect(
      wpUserWriteHandler(reg(shellTarget(wpCli, "https://prod.test")), prod, {
        target_id: "tgt_user0001",
        action: "create",
        username: "a",
        email: "a@x.test",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });

    const out = await wpUserWriteHandler(
      reg(shellTarget(wpCli, "https://prod.test")),
      prod,
      {
        target_id: "tgt_user0001",
        action: "create",
        username: "a",
        email: "a@x.test",
        confirm: true,
      },
    );
    expect(out).toMatchObject({ user_id: 9 });
  });
});
