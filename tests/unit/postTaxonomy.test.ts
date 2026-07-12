import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpPostCreateHandler } =
  await import("../../src/tools/atomic/wp_post_create.js");
const { wpPostUpdateHandler } =
  await import("../../src/tools/atomic/wp_post_update.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

/** Capture the REST body of the mutating call. GET (before-state) returns 200. */
function harness(postId = 10) {
  const bodies: Array<{ method: string; path: string; body?: unknown }> = [];
  const rest = vi.fn(
    async (req: { method: string; path: string; body?: unknown }) => {
      bodies.push(req);
      if (req.method === "GET") {
        return {
          status: 200,
          body: { title: { raw: "" }, content: { raw: "" } },
          headers: {},
        };
      }
      return {
        status: 200,
        body: { id: postId, link: "https://x.test/p" },
        headers: {},
      };
    },
  );
  const registry = {
    get: () => ({
      id: "tgt_posttax0",
      kind: "rest",
      siteurl: "https://x.test",
      rest,
    }),
  } as unknown as TargetRegistry;
  const mutateBody = () =>
    bodies.find((b) => b.method === "POST" || b.method === "PUT")?.body as
      | Record<string, unknown>
      | undefined;
  return { registry, mutateBody };
}

const guard = new ProdGuard([]);

beforeEach(() => vi.clearAllMocks());

describe("post_create — taxonomy params", () => {
  it("passes categories and tags through to the REST body", async () => {
    const { registry, mutateBody } = harness();
    await wpPostCreateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      title: "T",
      content: "C",
      categories: [3, 4],
      tags: [7],
    });
    expect(mutateBody()).toMatchObject({ categories: [3, 4], tags: [7] });
  });

  it("omits them when not given", async () => {
    const { registry, mutateBody } = harness();
    await wpPostCreateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      title: "T",
      content: "C",
    });
    expect(mutateBody()).not.toHaveProperty("categories");
    expect(mutateBody()).not.toHaveProperty("tags");
    expect(mutateBody()).not.toHaveProperty("featured_media");
  });

  it("passes featured_media through to the REST body", async () => {
    const { registry, mutateBody } = harness();
    await wpPostCreateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      title: "T",
      content: "C",
      featured_media: 55,
    });
    expect(mutateBody()).toMatchObject({ featured_media: 55 });
  });
});

describe("post_update — taxonomy params", () => {
  it("passes categories through", async () => {
    const { registry, mutateBody } = harness();
    await wpPostUpdateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      id: 10,
      categories: [5],
    });
    expect(mutateBody()).toMatchObject({ categories: [5] });
  });

  it("a categories-only update does not trip NO_FIELDS", async () => {
    const { registry } = harness();
    await expect(
      wpPostUpdateHandler(registry, guard, {
        target_id: "tgt_posttax0",
        id: 10,
        tags: [1],
      }),
    ).resolves.toBeDefined();
  });

  it("a featured_media-only update passes through and does not trip NO_FIELDS", async () => {
    const { registry, mutateBody } = harness();
    await wpPostUpdateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      id: 10,
      featured_media: 88,
    });
    expect(mutateBody()).toMatchObject({ featured_media: 88 });
  });

  it("still rejects a truly empty update", async () => {
    const { registry } = harness();
    await expect(
      wpPostUpdateHandler(registry, guard, {
        target_id: "tgt_posttax0",
        id: 10,
      }),
    ).rejects.toMatchObject({ code: "POST_UPDATE_NO_FIELDS" });
  });

  it("warns when the slug changes (old URL will 404)", async () => {
    // GET returns the current slug; the mutating response reports the new slug.
    const bodies: Array<{ method: string; path: string; body?: unknown }> = [];
    const rest = vi.fn(
      async (req: { method: string; path: string; body?: unknown }) => {
        bodies.push(req);
        if (req.method === "GET")
          return {
            status: 200,
            body: {
              title: { raw: "" },
              content: { raw: "" },
              slug: "old-slug",
            },
            headers: {},
          };
        return {
          status: 200,
          body: { id: 10, slug: "new-slug" },
          headers: {},
        };
      },
    );
    const registry = {
      get: () => ({
        id: "tgt_posttax0",
        kind: "rest",
        siteurl: "https://x.test",
        rest,
      }),
    } as unknown as TargetRegistry;
    const out = await wpPostUpdateHandler(registry, guard, {
      target_id: "tgt_posttax0",
      id: 10,
      slug: "new-slug",
    });
    expect(out.slug_changed_warning).toMatch(/old-slug.*new-slug|404/);
  });
});
