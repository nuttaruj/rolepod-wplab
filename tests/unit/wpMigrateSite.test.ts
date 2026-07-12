import { beforeEach, describe, expect, it, vi } from "vitest";

// Per-target companion bridges. bridgeFor dispatches on target.id so the source
// and dest each get their own mocked surface (step 0 backs up dest, step 1 the
// source — separate bridges prove no cross-talk).
const srcBridge = {
  backupStart: vi.fn(),
  backupStatus: vi.fn(),
  backupDownloadChunk: vi.fn(),
  backupImportChunk: vi.fn(),
  restoreStart: vi.fn(),
  restoreStatus: vi.fn(),
};
const dstBridge = {
  backupStart: vi.fn(),
  backupStatus: vi.fn(),
  backupDownloadChunk: vi.fn(),
  backupImportChunk: vi.fn(),
  restoreStart: vi.fn(),
  restoreStatus: vi.fn(),
};
const order: string[] = [];

vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async (t: { id: string }) =>
    t.id === "tgt_src00001" ? srcBridge : dstBridge,
}));

const { wpMigrateSiteHandler } =
  await import("../../src/tools/composite/wp_migrate_site.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function makeTarget(
  id: string,
  kind: string,
  siteurl: string,
  companion = true,
) {
  return {
    id,
    kind,
    siteurl,
    companion: { enabled: companion },
  };
}

function registryOf(
  source: ReturnType<typeof makeTarget>,
  dest: ReturnType<typeof makeTarget>,
): TargetRegistry {
  return {
    get: (id: string) => (id === source.id ? source : dest),
  } as unknown as TargetRegistry;
}

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
});

describe("wp_migrate_site — REST↔REST orchestration", () => {
  it("backs up dest first, snapshots source, transfers byte-identically, and restores with url rewrite", async () => {
    const payload = Buffer.from(
      Array.from({ length: 4096 }, (_, i) => (i * 5) % 256),
    );

    // Step 0 — dest backup.
    dstBridge.backupStart.mockImplementation(async () => {
      order.push("dst_backup_start");
      return { ok: true, job: { id: "dst-rollback-1", status: "running" } };
    });
    dstBridge.backupStatus.mockResolvedValue({
      ok: true,
      job: { status: "done" },
    });

    // Step 1 — source backup.
    srcBridge.backupStart.mockImplementation(async () => {
      order.push("src_backup_start");
      return { ok: true, job: { id: "src-bk-1", status: "running" } };
    });
    srcBridge.backupStatus.mockResolvedValue({
      ok: true,
      job: { status: "done" },
    });

    // Step 2 — source download serves the payload in chunks.
    srcBridge.backupDownloadChunk.mockImplementation(
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

    // Step 3 — dest import reassembles at contiguous offsets, returns a new id.
    let received = Buffer.alloc(0);
    dstBridge.backupImportChunk.mockImplementation(
      async ({
        offset,
        chunk,
        final,
      }: {
        offset: number;
        chunk: string;
        final: boolean;
      }) => {
        expect(offset).toBe(received.length);
        received = Buffer.concat([received, Buffer.from(chunk, "base64")]);
        return final
          ? {
              ok: true,
              done: true,
              id: "dst-imported-1",
              bytes: received.length,
            }
          : { ok: true, done: false, received: received.length };
      },
    );

    // Step 4 — dest restore.
    dstBridge.restoreStart.mockImplementation(async () => {
      order.push("dst_restore_start");
      return { ok: true, job: { status: "running" } };
    });
    dstBridge.restoreStatus.mockResolvedValue({
      ok: true,
      job: { status: "done" },
    });

    const source = makeTarget("tgt_src00001", "rest", "https://source.test");
    const dest = makeTarget("tgt_dst00001", "rest", "https://dest.test");
    const out = await wpMigrateSiteHandler(
      registryOf(source, dest),
      new ProdGuard([]),
      {
        source_target_id: "tgt_src00001",
        dest_target_id: "tgt_dst00001",
        allow_destructive: true,
        chunk_bytes: 1000,
      },
    );

    // Dest backup (step 0) precedes source backup (step 1), which precedes restore.
    expect(order).toEqual([
      "dst_backup_start",
      "src_backup_start",
      "dst_restore_start",
    ]);
    // Byte-identical transfer end to end.
    expect(received.equals(payload)).toBe(true);
    // Restore targets the imported id and rewrites source host → dest host.
    expect(dstBridge.restoreStart).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "dst-imported-1",
        confirm: true,
        search_replace: { "source.test": "dest.test" },
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.dest_rollback_backup_id).toBe("dst-rollback-1");
    expect(out.source_backup_id).toBe("src-bk-1");
    expect(out.steps.map((s) => s.step)).toEqual([
      "backup_dest",
      "backup_source",
      "download_source",
      "import_to_dest",
      "restore_dest",
    ]);
  });

  it("rejects a shell source with UNSUPPORTED_TARGET before touching anything", async () => {
    const source = makeTarget("tgt_src00001", "ssh", "https://source.test");
    const dest = makeTarget("tgt_dst00001", "rest", "https://dest.test");
    await expect(
      wpMigrateSiteHandler(registryOf(source, dest), new ProdGuard([]), {
        source_target_id: "tgt_src00001",
        dest_target_id: "tgt_dst00001",
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "MIGRATE_UNSUPPORTED_TARGET" });
    expect(dstBridge.backupStart).not.toHaveBeenCalled();
  });

  it("blocks a production dest without confirm and starts NO backup", async () => {
    const source = makeTarget("tgt_src00001", "rest", "https://source.test");
    const dest = makeTarget("tgt_dst00001", "rest", "https://prod.test");
    await expect(
      wpMigrateSiteHandler(
        registryOf(source, dest),
        new ProdGuard(["prod.test"]),
        {
          source_target_id: "tgt_src00001",
          dest_target_id: "tgt_dst00001",
          allow_destructive: true,
        },
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });
    // Step 0 must not run — a blocked migration touches nothing.
    expect(dstBridge.backupStart).not.toHaveBeenCalled();
    expect(srcBridge.backupStart).not.toHaveBeenCalled();
  });

  it("surfaces the dest rollback id when the restore fails", async () => {
    dstBridge.backupStart.mockResolvedValue({
      ok: true,
      job: { id: "dst-rollback-9", status: "running" },
    });
    dstBridge.backupStatus.mockResolvedValue({
      ok: true,
      job: { status: "done" },
    });
    srcBridge.backupStart.mockResolvedValue({
      ok: true,
      job: { id: "src-bk-9", status: "running" },
    });
    srcBridge.backupStatus.mockResolvedValue({
      ok: true,
      job: { status: "done" },
    });
    srcBridge.backupDownloadChunk.mockResolvedValue({
      ok: true,
      offset: 0,
      length: 3,
      total_bytes: 3,
      eof: true,
      data: Buffer.from("zip").toString("base64"),
    });
    dstBridge.backupImportChunk.mockResolvedValue({
      ok: true,
      done: true,
      id: "dst-imported-9",
    });
    // Restore refuses to start.
    dstBridge.restoreStart.mockResolvedValue({
      ok: false,
      error_code: "BACKUP_NOT_FOUND",
    });

    const source = makeTarget("tgt_src00001", "rest", "https://source.test");
    const dest = makeTarget("tgt_dst00001", "rest", "https://dest.test");
    await expect(
      wpMigrateSiteHandler(registryOf(source, dest), new ProdGuard([]), {
        source_target_id: "tgt_src00001",
        dest_target_id: "tgt_dst00001",
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({
      code: "MIGRATE_RESTORE_FAILED",
      meta: { dest_rollback_backup_id: "dst-rollback-9" },
    });
  });
});
