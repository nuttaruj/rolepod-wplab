import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpCommentHandler } =
  await import("../../src/tools/atomic/wp_comment.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function shellTarget(wpCli: ReturnType<typeof vi.fn>) {
  return {
    id: "tgt_cmt00001",
    kind: "local",
    siteurl: "https://x.test",
    wpCli,
  };
}
function restTarget(rest: ReturnType<typeof vi.fn>) {
  return {
    id: "tgt_cmt00001",
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

describe("wp_comment — moderate", () => {
  it("wp-cli spam maps to `comment spam`", async () => {
    const wpCli = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    const out = await wpCommentHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_cmt00001",
      action: "moderate",
      id: 3,
      status: "spam",
    });
    expect(out).toMatchObject({
      comment_id: 3,
      status: "spam",
      source: "wp_cli",
    });
    expect(wpCli).toHaveBeenCalledWith(["comment", "spam", "3"], {
      allowDestructive: true,
    });
  });

  it("REST approve maps status → approved", async () => {
    const rest = vi.fn(async () => ({ status: 200, body: {}, headers: {} }));
    await wpCommentHandler(reg(restTarget(rest)), guard, {
      target_id: "tgt_cmt00001",
      action: "moderate",
      id: 3,
      status: "approve",
    });
    expect(rest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/wp/v2/comments/3",
        body: { status: "approved" },
      }),
    );
  });
});

describe("wp_comment — delete", () => {
  it("wp-cli force delete adds --force", async () => {
    const wpCli = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
    await wpCommentHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_cmt00001",
      action: "delete",
      id: 4,
      force: true,
    });
    expect(wpCli).toHaveBeenCalledWith(["comment", "delete", "4", "--force"], {
      allowDestructive: true,
    });
  });

  it("REST force delete sends force=true", async () => {
    const rest = vi.fn(async () => ({ status: 200, body: {}, headers: {} }));
    await wpCommentHandler(reg(restTarget(rest)), guard, {
      target_id: "tgt_cmt00001",
      action: "delete",
      id: 4,
      force: true,
    });
    expect(rest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/wp/v2/comments/4",
        query: { force: true },
      }),
    );
  });
});

describe("wp_comment — list", () => {
  it("wp-cli list parses json", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{ comment_ID: 1 }]),
      stderr: "",
    }));
    const out = await wpCommentHandler(reg(shellTarget(wpCli)), guard, {
      target_id: "tgt_cmt00001",
      action: "list",
    });
    expect(out.comments).toEqual([{ comment_ID: 1 }]);
  });
});
