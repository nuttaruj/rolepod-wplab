import { describe, expect, it, vi } from "vitest";
import { wpCliRunHandler } from "../../src/tools/atomic/wp_cli_run.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";
import type { TargetKind } from "../../src/runtime/Target.js";

const KINDS: readonly TargetKind[] = ["local", "rest", "ssh", "docker"];

function fakeRegistry(kind: TargetKind) {
  const wpCli = vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok",
    stderr: "",
    durationMs: 3,
  }));
  const registry = {
    get: vi.fn(() => ({ id: "tgt_abc12345", kind, wpCli })),
  } as unknown as TargetRegistry;
  return { registry, wpCli };
}

describe("wpCliRunHandler — allow-list applies to every target kind", () => {
  it.each(KINDS)("blocks never-allowed `db reset` on %s", async (kind) => {
    const { registry, wpCli } = fakeRegistry(kind);
    await expect(
      wpCliRunHandler(registry, {
        target_id: "tgt_abc12345",
        args: ["db", "reset"],
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "WPCLI_BLOCKED" });
    expect(wpCli).not.toHaveBeenCalled();
  });

  it.each(KINDS)("blocks raw `eval` on %s", async (kind) => {
    const { registry, wpCli } = fakeRegistry(kind);
    await expect(
      wpCliRunHandler(registry, {
        target_id: "tgt_abc12345",
        args: ["eval", "echo 1;"],
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "WPCLI_BLOCKED" });
    expect(wpCli).not.toHaveBeenCalled();
  });

  it.each(KINDS)(
    "blocks destructive `plugin install` without the flag on %s",
    async (kind) => {
      const { registry, wpCli } = fakeRegistry(kind);
      await expect(
        wpCliRunHandler(registry, {
          target_id: "tgt_abc12345",
          args: ["plugin", "install", "hello-dolly"],
        }),
      ).rejects.toMatchObject({ code: "WPCLI_BLOCKED" });
      expect(wpCli).not.toHaveBeenCalled();
    },
  );

  it.each(KINDS)("allows read-only `plugin list` on %s", async (kind) => {
    const { registry, wpCli } = fakeRegistry(kind);
    const out = await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["plugin", "list"],
    });
    expect(out.exit_code).toBe(0);
    expect(wpCli).toHaveBeenCalledOnce();
  });

  it.each(KINDS)(
    "allows destructive `plugin install` with the flag on %s",
    async (kind) => {
      const { registry, wpCli } = fakeRegistry(kind);
      await wpCliRunHandler(registry, {
        target_id: "tgt_abc12345",
        args: ["plugin", "install", "hello-dolly"],
        allow_destructive: true,
      });
      expect(wpCli).toHaveBeenCalledOnce();
    },
  );

  it("blocks before resolving the target", async () => {
    const { registry } = fakeRegistry("local");
    await expect(
      wpCliRunHandler(registry, {
        target_id: "tgt_abc12345",
        args: ["db", "drop"],
      }),
    ).rejects.toMatchObject({ code: "WPCLI_BLOCKED" });
    expect(registry.get).not.toHaveBeenCalled();
  });
});

describe("wpCliRunHandler — output cap (brief 14)", () => {
  function bigRegistry(stdout: string, stderr = "") {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout,
      stderr,
      durationMs: 3,
    }));
    const registry = {
      get: vi.fn(() => ({ id: "tgt_abc12345", kind: "local", wpCli })),
    } as unknown as TargetRegistry;
    return { registry, wpCli };
  }

  it("returns small output whole, with the accounting fields", async () => {
    const { registry } = bigRegistry("ok");
    const out = await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["plugin", "list"],
    });
    expect(out.stdout).toBe("ok");
    expect(out.truncated).toBe(false);
    expect(out.total_bytes).toBe(2);
    expect(out.returned_bytes).toBe(2);
  });

  it("caps at 64 KB by default and says so", async () => {
    const big = "x".repeat(200_000);
    const { registry } = bigRegistry(big);
    const out = await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["option", "list"],
    });
    expect(out.truncated).toBe(true);
    expect(out.returned_bytes).toBeLessThanOrEqual(65_536);
    expect(Buffer.byteLength(out.stdout)).toBe(out.returned_bytes);
    expect(out.total_bytes).toBe(200_000);
  });

  it("honours an explicit max_bytes", async () => {
    const { registry } = bigRegistry("y".repeat(1000));
    const out = await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["plugin", "list"],
      max_bytes: 10,
    });
    expect(out.stdout).toBe("y".repeat(10));
    expect(out.truncated).toBe(true);
    expect(out.total_bytes).toBe(1000);
  });

  it("caps stderr as well", async () => {
    const { registry } = bigRegistry("", "e".repeat(1000));
    const out = await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["plugin", "list"],
      max_bytes: 10,
    });
    expect(out.stderr).toBe("e".repeat(10));
    expect(out.truncated).toBe(true);
  });

  it("caps in the handler only — the target call is unchanged", async () => {
    const { registry, wpCli } = bigRegistry("z".repeat(1000));
    await wpCliRunHandler(registry, {
      target_id: "tgt_abc12345",
      args: ["plugin", "list"],
      max_bytes: 10,
    });
    expect(wpCli).toHaveBeenCalledWith(["plugin", "list"], {
      allowDestructive: false,
      timeoutMs: 30_000,
    });
  });
});
