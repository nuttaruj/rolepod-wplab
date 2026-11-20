import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importBackup } from "../../src/companion/backupTransfer.js";
import { WplabError } from "../../src/util/errors.js";

function fakeBridge(failAt: Set<number>, appendBeforeFail: boolean) {
  let staged = 0;
  const calls: number[] = [];
  return {
    calls,
    bridge: {
      async backupImportChunk(input: Record<string, unknown>) {
        const offset = input["offset"] as number;
        const len = Buffer.from(String(input["chunk"]), "base64").length;
        calls.push(offset);
        if (offset !== staged) {
          throw new WplabError("OFFSET_MISMATCH", "x", { status: 409, expected_offset: staged });
        }
        if (failAt.has(offset)) {
          failAt.delete(offset);
          if (appendBeforeFail) staged += len;
          throw new WplabError("COMPANION_HTTP_502", "bad gateway", { status: 502 });
        }
        staged += len;
        return input["final"] ? { ok: true, done: true, staged } : { ok: true, done: false };
      },
    } as never,
  };
}

function src(bytes: number): string {
  const p = join(mkdtempSync(join(tmpdir(), "imp-")), "b.zip");
  writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

describe("importBackup retry", () => {
  it("resends a chunk whose 502 arrived before it was appended", async () => {
    const f = fakeBridge(new Set([4]), false);
    const r = await importBackup(f.bridge, src(10), 4);
    expect(r["staged"]).toBe(10);
    expect(f.calls).toEqual([0, 4, 4, 8]);
  }, 10000);

  it("follows expected_offset when the 502 arrived after the append", async () => {
    const f = fakeBridge(new Set([4]), true);
    const r = await importBackup(f.bridge, src(10), 4);
    expect(r["staged"]).toBe(10);
    expect(f.calls).toEqual([0, 4, 4, 8]);
  }, 10000);

  it("never retries the final chunk", async () => {
    const f = fakeBridge(new Set([8]), false);
    await expect(importBackup(f.bridge, src(10), 4)).rejects.toThrow("bad gateway");
  });
});
