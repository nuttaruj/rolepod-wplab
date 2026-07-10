import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud_1" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

const { replacePostMeta, PostMetaVerifyError, _exposed_for_tests } =
  await import("../../src/adapters/_shared/replacePostMeta.js");

import type { Target } from "../../src/runtime/Target.js";

/**
 * wp-cli stub. `post meta get` returns `reads.shift()`, `eval` returns exit 0.
 * A read of `null` means the key is unset.
 */
function fakeTarget(reads: (string | null)[]) {
  const wpCli = vi.fn(async (args: readonly string[]) => {
    if (args[0] === "post" && args[1] === "meta" && args[2] === "get") {
      const next = reads.shift() ?? null;
      return next === null
        ? { exitCode: 0, stdout: "", stderr: "", durationMs: 1 }
        : { exitCode: 0, stdout: next, stderr: "", durationMs: 1 };
    }
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  const fileWrite = vi.fn(async (path: string) => ({
    bytesWritten: 1,
    backupPath: null,
    absolutePath: `/srv/wp/${path}`,
  }));
  const target = {
    id: "tgt_metawrite",
    kind: "rest",
    siteurl: "https://x.test",
    wpVersion: "6.5",
    companion: {
      installed: true,
      enabled: true,
      version: "2.22",
      capabilities: [],
    },
    wpCli,
    fileWrite,
  } as unknown as Target;
  return { target, wpCli, fileWrite };
}

const TREE = [{ id: "a", elType: "container" }];

beforeEach(() => {
  recordChange.mockClear();
});

describe("replacePostMeta — read-back verification", () => {
  it("passes when the site returns what was written", async () => {
    const { target } = fakeTarget([null, JSON.stringify(TREE)]);
    const res = await replacePostMeta(
      target,
      7,
      "_bricks_page_content_2",
      TREE,
      {
        backupPrefix: "bricks-page",
        serialization: "json",
        sourceTool: "rolepod_wp_bricks_write",
      },
    );
    expect(res.verified).toBe(true);
    expect(res.backupPath).toBeNull();
  });

  it("throws when the meta is empty after the write", async () => {
    // `wp eval` exits 0 even when update_post_meta returns false.
    const { target } = fakeTarget([null, null]);
    await expect(
      replacePostMeta(target, 7, "_bricks_page_content_2", TREE, {
        backupPrefix: "bricks-page",
        serialization: "json",
        sourceTool: "rolepod_wp_bricks_write",
      }),
    ).rejects.toBeInstanceOf(PostMetaVerifyError);
  });

  it("throws when the site returns a different tree, and names the backup", async () => {
    const { target } = fakeTarget([
      JSON.stringify([{ id: "old" }]),
      JSON.stringify([{ id: "something-else" }]),
    ]);
    await expect(
      replacePostMeta(target, 7, "_bricks_page_content_2", TREE, {
        backupPrefix: "bricks-page",
        serialization: "json",
        sourceTool: "rolepod_wp_bricks_write",
      }),
    ).rejects.toThrow(/bricks-page-7-.*\.json/);
  });

  it("does not record a ledger row for a write it could not verify", async () => {
    const { target } = fakeTarget([null, null]);
    await expect(
      replacePostMeta(target, 7, "k", TREE, {
        backupPrefix: "p",
        serialization: "json",
        sourceTool: "t",
      }),
    ).rejects.toThrow();
    expect(recordChange).not.toHaveBeenCalled();
  });

  it("compares json-string round-trips against the payload, not the value", async () => {
    const payload = JSON.stringify(TREE);
    const { target } = fakeTarget([null, JSON.stringify(payload)]);
    const res = await replacePostMeta(target, 9, "_elementor_data", TREE, {
      backupPrefix: "elementor",
      serialization: "json-string",
      sourceTool: "rolepod_wp_elementor_write",
    });
    expect(res.verified).toBe(true);
  });

  it("compares raw round-trips against the string", async () => {
    const shortcodes = "[ct_section][/ct_section]";
    const { target } = fakeTarget([null, JSON.stringify(shortcodes)]);
    const res = await replacePostMeta(
      target,
      3,
      "ct_builder_shortcodes",
      shortcodes,
      {
        backupPrefix: "oxygen",
        serialization: "raw",
        sourceTool: "rolepod_wp_oxygen_write",
      },
    );
    expect(res.verified).toBe(true);
  });
});

describe("replacePostMeta — ledger", () => {
  it("records a reversible row for `json` and returns the audit id", async () => {
    const { target } = fakeTarget([null, JSON.stringify(TREE)]);
    const res = await replacePostMeta(
      target,
      7,
      "_bricks_page_content_2",
      TREE,
      {
        backupPrefix: "bricks-page",
        serialization: "json",
        sourceTool: "rolepod_wp_bricks_write",
      },
    );
    expect(res.auditId).toBe("aud_1");
    expect(recordChange).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        category: "layout",
        subcategory: "_bricks_page_content_2",
        targetDescriptor: "post:7:_bricks_page_content_2",
        reversible: true,
        sourceTool: "rolepod_wp_bricks_write",
      }),
    );
  });

  it("records a reversible row for `raw` — shortcodes round-trip cleanly", async () => {
    const s = "[ct_section][/ct_section]";
    const { target } = fakeTarget([null, JSON.stringify(s)]);
    await replacePostMeta(target, 3, "ct_builder_shortcodes", s, {
      backupPrefix: "oxygen",
      serialization: "raw",
      sourceTool: "rolepod_wp_oxygen_write",
    });
    expect(recordChange).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ reversible: true }),
    );
  });

  it("records `json-string` as NOT reversible, and says where the backup is", async () => {
    const payload = JSON.stringify(TREE);
    const { target } = fakeTarget(['"old"', JSON.stringify(payload)]);
    await replacePostMeta(target, 9, "_elementor_data", TREE, {
      backupPrefix: "elementor",
      serialization: "json-string",
      sourceTool: "rolepod_wp_elementor_write",
    });
    const record = recordChange.mock.calls[0]![1] as {
      reversible: boolean;
      notes: string;
    };
    expect(record.reversible).toBe(false);
    expect(record.notes).toMatch(/Restore by hand from .*elementor-9-.*\.json/);
  });

  it("honours an explicit category", async () => {
    const { target } = fakeTarget([null, JSON.stringify(["noindex"])]);
    await replacePostMeta(target, 4, "rank_math_robots", ["noindex"], {
      backupPrefix: "rankmath-robots",
      serialization: "json",
      sourceTool: "rolepod_wp_rankmath_write",
      category: "post",
    });
    expect(recordChange).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ category: "post" }),
    );
  });
});

describe("deepEqualThroughPhp — tolerates the one transform PHP always applies", () => {
  const { deepEqualThroughPhp } = _exposed_for_tests;

  it("treats `{}` and `[]` as equal — PHP cannot tell them apart", () => {
    expect(deepEqualThroughPhp([], {})).toBe(true);
    expect(deepEqualThroughPhp({ settings: [] }, { settings: {} })).toBe(true);
  });

  it("accepts a Bricks widget whose empty settings came back as an array", () => {
    const written = [{ id: "a", name: "heading", settings: {} }];
    const readBack = [{ id: "a", name: "heading", settings: [] }];
    expect(deepEqualThroughPhp(readBack, written)).toBe(true);
  });

  it("still rejects a non-empty difference", () => {
    expect(deepEqualThroughPhp({ settings: { a: 1 } }, { settings: {} })).toBe(
      false,
    );
    expect(deepEqualThroughPhp([{ id: "a" }], [{ id: "b" }])).toBe(false);
  });

  it("does not coerce scalars", () => {
    expect(deepEqualThroughPhp({ n: 1 }, { n: "1" })).toBe(false);
  });
});

describe("deepEqual", () => {
  const { deepEqual } = _exposed_for_tests;

  it("ignores object key order", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("respects array order", () => {
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
  });

  it("separates an empty array from an empty object", () => {
    expect(deepEqual([], {})).toBe(false);
  });

  it("does not coerce types", () => {
    expect(deepEqual({ n: 1 }, { n: "1" })).toBe(false);
    expect(deepEqual(null, undefined)).toBe(false);
  });

  it("recurses", () => {
    expect(deepEqual({ a: [{ b: { c: 1 } }] }, { a: [{ b: { c: 1 } }] })).toBe(
      true,
    );
    expect(deepEqual({ a: [{ b: { c: 1 } }] }, { a: [{ b: { c: 2 } }] })).toBe(
      false,
    );
  });
});
