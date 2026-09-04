import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const downloadChunk = vi.fn();
const importChunk = vi.fn();
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => ({
    backupDownloadChunk: downloadChunk,
    backupImportChunk: importChunk,
  }),
}));

const { wpSiteBackupHandler } =
  await import("../../src/tools/companion/wp_site_backup.js");
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const target = {
  id: "tgt_backup001",
  kind: "rest",
  siteurl: "https://x.test",
  companion: { enabled: true },
} as const;
const registry = { get: () => target } as unknown as TargetRegistry;

let dir = "";
beforeEach(async () => {
  downloadChunk.mockReset();
  importChunk.mockReset();
  dir = await mkdtemp(join(tmpdir(), "rolepod-backup-xfer-"));
});
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("wp_site_backup — download/import chunked transfer", () => {
  it("download reassembles a byte-identical local file", async () => {
    const payload = Buffer.from(
      Array.from({ length: 5000 }, (_, i) => i % 256),
    );
    downloadChunk.mockImplementation(
      async ({ offset, length }: { offset: number; length: number }) => {
        const slice = payload.subarray(offset, offset + length);
        return {
          ok: true,
          offset,
          length: slice.length,
          total_bytes: payload.length,
          eof: offset + slice.length >= payload.length,
          data: slice.toString("base64"),
        };
      },
    );
    const dest = join(dir, "pulled.zip");

    const out = await wpSiteBackupHandler(registry, {
      target_id: "tgt_backup001",
      action: "download",
      id: "bk-1",
      dest_path: dest,
      chunk_bytes: 1000,
    });

    // Multiple round trips (5000 / 1000 = 5, plus the eof check).
    expect(downloadChunk.mock.calls.length).toBeGreaterThanOrEqual(5);
    const onDisk = await readFile(dest);
    expect(onDisk.equals(payload)).toBe(true);
    expect(out).toMatchObject({
      action: "download",
      bytes: payload.length,
      total_bytes: payload.length,
      complete: true,
      ok: true,
    });
  });

  it("import pushes the file chunk-by-chunk at contiguous offsets and finalizes", async () => {
    const srcBytes = Buffer.from(
      Array.from({ length: 3500 }, (_, i) => (i * 7) % 256),
    );
    const src = join(dir, "to-import.zip");
    await writeFile(src, srcBytes);

    let received = Buffer.alloc(0);
    let finalFilename = "";
    importChunk.mockImplementation(
      async ({
        offset,
        chunk,
        final,
        filename,
      }: {
        offset: number;
        chunk: string;
        final: boolean;
        filename?: string;
      }) => {
        expect(offset).toBe(received.length); // companion's OFFSET_MISMATCH guard
        received = Buffer.concat([received, Buffer.from(chunk, "base64")]);
        if (final) {
          finalFilename = filename ?? "";
          return {
            ok: true,
            done: true,
            id: "imported-1",
            bytes: received.length,
          };
        }
        return { ok: true, done: false, received: received.length };
      },
    );

    const out = await wpSiteBackupHandler(registry, {
      target_id: "tgt_backup001",
      action: "import",
      src_path: src,
      chunk_bytes: 1000,
    });

    expect(received.equals(srcBytes)).toBe(true);
    expect(finalFilename).toBe("to-import.zip");
    expect(out).toMatchObject({
      action: "import",
      ok: true,
      done: true,
      id: "imported-1",
    });
  });

  it("download requires dest_path", async () => {
    await expect(
      wpSiteBackupHandler(registry, {
        target_id: "tgt_backup001",
        action: "download",
        id: "bk-1",
      }),
    ).rejects.toThrow(/dest_path/);
  });

  it("import rejects an empty source file", async () => {
    const empty = join(dir, "empty.zip");
    await writeFile(empty, new Uint8Array());
    await expect(
      wpSiteBackupHandler(registry, {
        target_id: "tgt_backup001",
        action: "import",
        src_path: empty,
      }),
    ).rejects.toThrow(/empty/i);
    expect(importChunk).not.toHaveBeenCalled();
  });
});
