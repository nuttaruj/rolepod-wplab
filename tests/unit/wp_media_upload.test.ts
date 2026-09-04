import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaImport = vi.fn();
let caps = new Set<string>();
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => ({
    hasCapability: (c: string) => caps.has(c),
    mediaImport,
  }),
}));

const { wpMediaUploadHandler } =
  await import("../../src/tools/companion/wp_media_upload.js");
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const rest = vi.fn();
const target = {
  id: "tgt_media001",
  kind: "rest",
  siteurl: "https://x.test",
  companion: { enabled: true },
  rest,
} as const;
const registry = { get: () => target } as unknown as TargetRegistry;

beforeEach(() => {
  mediaImport.mockReset();
  rest.mockReset();
  caps = new Set();
});

describe("wp_media_upload — companion vs bare-REST transport", () => {
  it("routes through the companion when media_import is advertised (ledgered)", async () => {
    caps = new Set(["media_import"]);
    mediaImport.mockResolvedValue({
      ok: true,
      attachment_id: 42,
      url: "https://x.test/u/a.png",
      alt: "cat",
    });

    const out = await wpMediaUploadHandler(registry, {
      target_id: "tgt_media001",
      source: "url",
      url: "https://cdn.test/a.png",
      alt: "cat",
    });

    expect(mediaImport).toHaveBeenCalledTimes(1);
    expect(mediaImport.mock.calls[0]![0]).toMatchObject({
      source: "url",
      url: "https://cdn.test/a.png",
      alt: "cat",
    });
    expect(out).toMatchObject({
      source_transport: "companion",
      ledgered: true,
      attachment_id: 42,
    });
    expect(rest).not.toHaveBeenCalled();
  });

  it("falls back to a bare-REST binary upload when the capability is absent (not ledgered)", async () => {
    caps = new Set();
    rest.mockImplementation(async (req: { path: string }) => {
      if (req.path === "/wp/v2/media") {
        return {
          status: 201,
          body: { id: 77, source_url: "https://x.test/u/b.png" },
          headers: {},
        };
      }
      return { status: 200, body: {}, headers: {} };
    });

    const data = Buffer.from("PNGDATA").toString("base64");
    const out = await wpMediaUploadHandler(registry, {
      target_id: "tgt_media001",
      source: "base64",
      data,
      filename: "b.png",
      alt: "dog",
    });

    const media = rest.mock.calls.find((c) => c[0].path === "/wp/v2/media")![0];
    expect(media.method).toBe("POST");
    expect(media.body).toBeInstanceOf(Uint8Array);
    expect(media.headers["Content-Type"]).toBe("image/png");
    expect(media.headers["Content-Disposition"]).toContain('filename="b.png"');

    // alt is a second (json) call, not part of the binary body.
    const patch = rest.mock.calls.find(
      (c) => c[0].path === "/wp/v2/media/77",
    )![0];
    expect(patch.body).toMatchObject({ alt_text: "dog" });

    expect(out).toMatchObject({
      source_transport: "rest",
      ledgered: false,
      attachment_id: 77,
    });
    expect(String(out.note)).toContain("/wp/v2/media/77");
  });

  it("sets the post's featured_media when set_featured=true", async () => {
    caps = new Set(["media_import"]);
    mediaImport.mockResolvedValue({ ok: true, attachment_id: 42 });
    rest.mockResolvedValue({ status: 200, body: {}, headers: {} });

    const out = await wpMediaUploadHandler(registry, {
      target_id: "tgt_media001",
      source: "base64",
      data: Buffer.from("x").toString("base64"),
      alt: "a",
      set_featured: true,
      attach_to_post: 9,
      attach_to_post_type: "pages",
    });

    const feat = rest.mock.calls.find(
      (c) => c[0].path === "/wp/v2/pages/9",
    )![0];
    expect(feat.body).toMatchObject({ featured_media: 42 });
    expect(out.featured_set).toBe(9);
  });

  it("rejects set_featured without attach_to_post (no silent no-op)", async () => {
    await expect(
      wpMediaUploadHandler(registry, {
        target_id: "tgt_media001",
        source: "base64",
        data: "eA==",
        set_featured: true,
      }),
    ).rejects.toThrow();
  });

  it("rejects a source missing its payload field", async () => {
    await expect(
      wpMediaUploadHandler(registry, {
        target_id: "tgt_media001",
        source: "url",
      }),
    ).rejects.toThrow();
  });

  it("refuses url/local_path over bare REST (needs the companion)", async () => {
    caps = new Set();
    await expect(
      wpMediaUploadHandler(registry, {
        target_id: "tgt_media001",
        source: "url",
        url: "https://cdn.test/a.png",
      }),
    ).rejects.toThrow(/companion/i);
  });

  it("requires a rest target", async () => {
    const localReg = {
      get: () => ({
        id: "tgt_local001",
        kind: "local",
        siteurl: "",
        companion: { enabled: false },
      }),
    } as unknown as TargetRegistry;
    await expect(
      wpMediaUploadHandler(localReg, {
        target_id: "tgt_local001",
        source: "base64",
        data: "eA==",
      }),
    ).rejects.toThrow(/rest target/);
  });
});
