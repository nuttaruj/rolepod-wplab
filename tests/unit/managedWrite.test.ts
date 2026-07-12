import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));
const flushObjectCache = vi.fn(async () => {});
vi.mock("../../src/companion/cacheFlush.js", () => ({ flushObjectCache }));
const syntaxCheck = vi.fn();
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => ({ syntaxCheck }),
}));

const { writeManagedFile } =
  await import("../../src/companion/managedWrite.js");
import type { Target } from "../../src/runtime/Target.js";

function target(kind = "rest") {
  const writes: Array<{ path: string; content: string }> = [];
  const t = {
    id: "tgt_mw000001",
    kind,
    siteurl: "https://x.test",
    companion: { enabled: true },
    fileRead: vi.fn(async () => {
      throw new Error("ENOENT"); // treat as new file
    }),
    fileWrite: vi.fn(async (path: string, content: string) => {
      writes.push({ path, content });
      return {
        absolutePath: `/abs/${path}`,
        bytesWritten: content.length,
        backupPath: null,
      };
    }),
  } as unknown as Target;
  return { t, writes };
}

beforeEach(() => {
  vi.clearAllMocks();
  syntaxCheck.mockResolvedValue({ ok: true });
});

describe("writeManagedFile", () => {
  it("writes, ledgers, and returns the byte count", async () => {
    const { t, writes } = target();
    const r = await writeManagedFile(
      t,
      "wp-content/themes/x/style.css",
      "body{}",
      {
        sourceTool: "test",
      },
    );
    expect(writes[0]).toMatchObject({ path: "wp-content/themes/x/style.css" });
    expect(recordChange).toHaveBeenCalledOnce();
    expect(r.bytesWritten).toBe(6);
  });

  it("runs php -l on a PHP file and BLOCKS the write on a syntax error", async () => {
    const { t } = target();
    syntaxCheck.mockResolvedValue({
      ok: false,
      errorLine: 3,
      errorMessage: "unexpected '}'",
    });
    await expect(
      writeManagedFile(t, "wp-content/themes/x/functions.php", "<?php }", {
        sourceTool: "test",
      }),
    ).rejects.toMatchObject({ code: "FS_WRITE_PHP_SYNTAX_ERROR" });
    // The write must NOT have happened.
    expect(t.fileWrite).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON before writing", async () => {
    const { t } = target();
    await expect(
      writeManagedFile(t, "wp-content/themes/x/theme.json", "{not json", {
        sourceTool: "test",
      }),
    ).rejects.toMatchObject({ code: "FS_WRITE_JSON_INVALID" });
    expect(t.fileWrite).not.toHaveBeenCalled();
  });

  it("flushes the object cache after a theme.json write", async () => {
    const { t } = target();
    await writeManagedFile(t, "wp-content/themes/x/theme.json", "{}", {
      sourceTool: "test",
    });
    expect(flushObjectCache).toHaveBeenCalledOnce();
  });

  it("skips php -l on non-rest targets (companion validator is REST-only)", async () => {
    const { t } = target("local");
    await writeManagedFile(
      t,
      "wp-content/themes/x/functions.php",
      "<?php bad(",
      {
        sourceTool: "test",
      },
    );
    expect(syntaxCheck).not.toHaveBeenCalled();
    expect(t.fileWrite).toHaveBeenCalledOnce();
  });
});
