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
