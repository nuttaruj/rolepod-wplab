import { beforeEach, describe, expect, it, vi } from "vitest";

const replacePostMeta = vi.fn(async () => ({
  bytesWritten: 10,
  backupPath: null,
  verified: true as const,
  auditId: "aud_1",
}));
vi.mock("../../src/adapters/_shared/replacePostMeta.js", () => ({
  replacePostMeta,
}));

const { bricksWrite, assertTemplatePost, BricksWrongPostTypeError } =
  await import("../../src/adapters/bricks/write.js");
import type { Target } from "../../src/runtime/Target.js";

function target(postType: string, exitCode = 0): Target {
  return {
    id: "tgt_brickswr",
    kind: "local",
    siteurl: "https://x.test",
    wpCli: vi.fn(async (args: readonly string[]) => {
      if (args.includes("--field=post_type")) {
        return { exitCode, stdout: postType, stderr: "", durationMs: 1 };
      }
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
    }),
  } as unknown as Target;
}

beforeEach(() => replacePostMeta.mockClear());

describe("bricksWrite — every scope writes _bricks_page_content_2", () => {
  it.each([
    "updatePageContent",
    "updateHeaderContent",
    "updateFooterContent",
  ] as const)("%s targets the shared meta key", async (method) => {
    await bricksWrite[method](target("bricks_template"), 5, []);
    expect(replacePostMeta).toHaveBeenCalledWith(
      expect.anything(),
      5,
      "_bricks_page_content_2",
      [],
      expect.objectContaining({ sourceTool: "rolepod_wp_bricks_write" }),
    );
  });
});

describe("assertTemplatePost — the page-body clobber guard", () => {
  it("lets a page scope through without checking the post type", async () => {
    const t = target("page");
    await expect(assertTemplatePost(t, 5, "page")).resolves.toBeUndefined();
    expect(t.wpCli).not.toHaveBeenCalled();
  });

  it.each(["header", "footer"] as const)(
    "allows a %s write onto a bricks_template",
    async (scope) => {
      await expect(
        assertTemplatePost(target("bricks_template"), 5, scope),
      ).resolves.toBeUndefined();
    },
  );

  it.each(["header", "footer"] as const)(
    "refuses a %s write onto a page — that would overwrite the body",
    async (scope) => {
      await expect(
        assertTemplatePost(target("page"), 5, scope),
      ).rejects.toBeInstanceOf(BricksWrongPostTypeError);
    },
  );

  it("refuses a header write onto a post", async () => {
    await expect(
      assertTemplatePost(target("post"), 5, "header"),
    ).rejects.toMatchObject({ code: "BRICKS_WRONG_POST_TYPE" });
  });

  it("fails closed when the post type cannot be read", async () => {
    await expect(
      assertTemplatePost(target("", 1), 5, "header"),
    ).rejects.toMatchObject({ code: "BRICKS_WRONG_POST_TYPE" });
  });
});
