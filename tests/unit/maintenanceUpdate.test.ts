import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const bridge = {
  backupStart: vi.fn(async () => ({
    ok: true,
    job: { id: "bk-1", status: "running" },
  })),
  backupStatus: vi.fn(async () => ({ ok: true, job: { status: "done" } })),
  restoreStart: vi.fn(async () => ({ ok: true, job: { status: "running" } })),
  restoreStatus: vi.fn(async () => ({ ok: true, job: { status: "done" } })),
};
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => bridge,
}));

const { wpMaintenanceUpdateHandler } =
  await import("../../src/tools/composite/wp_maintenance_update.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

interface Opts {
  multisite?: boolean;
  updateExit?: number;
  restStatus?: number | number[]; // health probe status(es), consumed in order
  companion?: boolean;
}

function harness(opts: Opts = {}) {
  const calls: string[] = [];
  const restStatuses = Array.isArray(opts.restStatus)
    ? [...opts.restStatus]
    : opts.restStatus !== undefined
      ? [opts.restStatus]
      : [200];
  const wpCli = vi.fn(async (args: readonly string[]) => {
    const key = args.join(" ");
    calls.push(key);
    if (key.startsWith("core is-installed"))
      return {
        exitCode: opts.multisite ? 0 : 1,
        stdout: "",
        stderr: "",
        durationMs: 1,
      };
    if (key === "core version")
      return { exitCode: 0, stdout: "6.4.1", stderr: "", durationMs: 1 };
    if (args.includes("update"))
      return {
        exitCode: opts.updateExit ?? 0,
        stdout: "",
        stderr: opts.updateExit ? "update boom" : "",
        durationMs: 1,
      };
    return { exitCode: 0, stdout: "", stderr: "", durationMs: 1 };
  });
  const rest = vi.fn(async () => ({
    status: restStatuses.length > 1 ? restStatuses.shift()! : restStatuses[0]!,
    body: {},
    headers: {},
  }));
  const target = {
    id: "tgt_maint0001",
    kind: opts.companion === false ? "local" : "rest",
    siteurl: "https://x.test",
    companion: { enabled: opts.companion !== false },
    wpCli,
    rest,
  };
  const registry = { get: () => target } as unknown as TargetRegistry;
  return { registry, calls, wpCli };
}

const guard = new ProdGuard([]);
beforeEach(() => {
  vi.clearAllMocks();
  bridge.backupStart.mockResolvedValue({
    ok: true,
    job: { id: "bk-1", status: "running" },
  });
  bridge.backupStatus.mockResolvedValue({ ok: true, job: { status: "done" } });
  bridge.restoreStatus.mockResolvedValue({ ok: true, job: { status: "done" } });
});

describe("wp_maintenance_update", () => {
  it("refuses multisite", async () => {
    const { registry } = harness({ multisite: true });
    await expect(
      wpMaintenanceUpdateHandler(registry, guard, {
        target_id: "tgt_maint0001",
        scope: "plugin",
      }),
    ).rejects.toMatchObject({ code: "MULTISITE_UNSUPPORTED" });
  });

  it("refuses a non-companion target", async () => {
    const { registry } = harness({ companion: false });
    await expect(
      wpMaintenanceUpdateHandler(registry, guard, {
        target_id: "tgt_maint0001",
        scope: "plugin",
      }),
    ).rejects.toMatchObject({ code: "MAINTENANCE_REQUIRES_COMPANION" });
  });

  it("requires a backup_id for scope=core", async () => {
    const { registry } = harness();
    await expect(
      wpMaintenanceUpdateHandler(registry, guard, {
        target_id: "tgt_maint0001",
        scope: "core",
      }),
    ).rejects.toMatchObject({ code: "MAINTENANCE_CORE_BACKUP_REQUIRED" });
  });

  it("deactivates maintenance-mode even when the update throws", async () => {
    const { registry, calls } = harness({ updateExit: 1 });
    await expect(
      wpMaintenanceUpdateHandler(registry, guard, {
        target_id: "tgt_maint0001",
        scope: "plugin",
      }),
    ).rejects.toMatchObject({ code: "MAINTENANCE_UPDATE_FAILED" });
    expect(calls).toContain("maintenance-mode activate");
    expect(calls).toContain("maintenance-mode deactivate");
  });

  it("green update records a maintenance ledger row", async () => {
    const { registry } = harness({ restStatus: 200 });
    const out = await wpMaintenanceUpdateHandler(registry, guard, {
      target_id: "tgt_maint0001",
      scope: "plugin",
      slugs: ["akismet"],
    });
    expect(out).toMatchObject({
      health_ok: true,
      rolled_back: false,
      backup_id: "bk-1",
      updated: ["akismet"],
    });
  });

  it("red update rolls back, re-probes green, reports rolled_back:true", async () => {
    // First probe (post-update) 500 → unhealthy; second probe (post-restore) 200.
    const { registry } = harness({ restStatus: [500, 200] });
    const out = await wpMaintenanceUpdateHandler(registry, guard, {
      target_id: "tgt_maint0001",
      scope: "plugin",
    });
    expect(bridge.restoreStart).toHaveBeenCalled();
    expect(out).toMatchObject({ health_ok: true, rolled_back: true });
  });

  it("red update + still-red after restore → rolled_back:false + manual note", async () => {
    const { registry } = harness({ restStatus: [500, 500] });
    const out = await wpMaintenanceUpdateHandler(registry, guard, {
      target_id: "tgt_maint0001",
      scope: "plugin",
    });
    expect(out).toMatchObject({ health_ok: false, rolled_back: false });
    expect(out.reason).toMatch(/MANUAL/);
  });
});
