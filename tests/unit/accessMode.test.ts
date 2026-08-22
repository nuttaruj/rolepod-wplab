import { describe, expect, it, vi } from "vitest";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import { TargetRegistry } from "../../src/target/TargetRegistry.js";
import type { Target } from "../../src/runtime/Target.js";
import { ProductionBlockedError } from "../../src/util/errors.js";

/**
 * One switch, two modes. The companion's full-access toggle is the owner's
 * decision: 'full' opens the power surface, 'guarded' keeps the safe subset.
 * The client mirrors the server-side enforcement so a guarded write fails
 * fast with a clear error, and a full-access site is never second-guessed by
 * host patterns or environment probes.
 */

let n = 0;
function fakeTarget(siteurl: string, wpCli?: Target["wpCli"]): Target {
  return {
    id: `tgt_mode${n++}`,
    kind: "rest",
    siteurl,
    wpVersion: "6.5",
    companion: null,
    wpCli:
      wpCli ??
      vi.fn(async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "no wp-cli",
        durationMs: 1,
      })),
    rest: vi.fn(),
    fileRead: vi.fn(),
    fileWrite: vi.fn(),
    fileExists: vi.fn(),
    rootPath: () => "/srv/wp",
    close: vi.fn(async () => undefined),
  } as unknown as Target;
}

describe("ProdGuard — full access vs guarded", () => {
  it("disarm() overrides a configured host pattern", () => {
    const guard = new ProdGuard(["live.example.com"]);
    expect(guard.isArmedFor("https://live.example.com")).toBe(true);
    guard.disarm("https://live.example.com");
    expect(guard.isArmedFor("https://live.example.com")).toBe(false);
  });

  it("disarm() overrides a host the site declared production", () => {
    const guard = new ProdGuard([]);
    guard.markProduction("https://live.example.com");
    guard.disarm("https://live.example.com");
    expect(guard.isArmedFor("https://live.example.com")).toBe(false);
  });

  it("armGuarded() arms a host nothing else would have matched", () => {
    const guard = new ProdGuard([]);
    expect(guard.isArmedFor("https://dev.example.com")).toBe(false);
    guard.armGuarded("https://dev.example.com");
    expect(guard.isArmedFor("https://dev.example.com")).toBe(true);
  });

  it("guarded match explains itself and names the fix", () => {
    const guard = new ProdGuard([]);
    guard.armGuarded("https://shop.example.com");
    const m = guard.matches("https://shop.example.com");
    expect(m.matched).toBe(true);
    if (m.matched) {
      expect(m.pattern).toContain("guarded mode");
      expect(m.pattern).toContain("AI Full Control");
      // The block must carry its own protocol: warn, then back up BEFORE
      // the toggle flips — not after the power surface is already open.
      expect(m.pattern).toContain("back up first");
      expect(m.pattern).toContain("rolepod_wp_backup_create");
    }
  });

  it("enforce() throws for a guarded host and passes for a full-access one", () => {
    const guard = new ProdGuard([]);
    guard.armGuarded("https://a.example.com");
    guard.disarm("https://b.example.com");
    expect(() => guard.enforce("https://a.example.com")).toThrow(
      ProductionBlockedError,
    );
    expect(() => guard.enforce("https://b.example.com")).not.toThrow();
  });

  it("modes are per-host and the latest report wins", () => {
    const guard = new ProdGuard([]);
    guard.armGuarded("https://site.example.com");
    expect(guard.isArmedFor("https://site.example.com")).toBe(true);
    // Owner flips the toggle on, target reconnects:
    guard.disarm("https://site.example.com");
    expect(guard.isArmedFor("https://site.example.com")).toBe(false);
    // …and off again:
    guard.armGuarded("https://site.example.com");
    expect(guard.isArmedFor("https://site.example.com")).toBe(true);
  });

  it("ignores a siteurl with no parseable host", () => {
    const guard = new ProdGuard([]);
    expect(guard.disarm("not a url")).toBe(false);
    expect(guard.armGuarded("not a url")).toBe(false);
  });
});

describe("TargetRegistry.register — accessMode", () => {
  it("'full' disarms and reports full_access without probing", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: "production",
      stderr: "",
      durationMs: 1,
    }));
    const guard = new ProdGuard(["live.example.com"]);
    const registry = new TargetRegistry(60_000, guard);
    const status = await registry.register(
      fakeTarget(
        "https://live.example.com",
        wpCli as unknown as Target["wpCli"],
      ),
      { accessMode: "full" },
    );
    expect(status).toEqual({
      env_type: null,
      armed: false,
      reason: "full_access",
    });
    expect(guard.isArmedFor("https://live.example.com")).toBe(false);
    expect(wpCli).not.toHaveBeenCalled();
  });

  it("'guarded' arms and reports guarded without probing", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: "development",
      stderr: "",
      durationMs: 1,
    }));
    const guard = new ProdGuard([]);
    const registry = new TargetRegistry(60_000, guard);
    const status = await registry.register(
      fakeTarget(
        "https://dev.example.com",
        wpCli as unknown as Target["wpCli"],
      ),
      { accessMode: "guarded" },
    );
    expect(status).toEqual({ env_type: null, armed: true, reason: "guarded" });
    expect(guard.isArmedFor("https://dev.example.com")).toBe(true);
    expect(wpCli).not.toHaveBeenCalled();
  });

  it("no accessMode falls back to the legacy probe path", async () => {
    const guard = new ProdGuard([]);
    const registry = new TargetRegistry(60_000, guard);
    const status = await registry.register(
      fakeTarget("https://box.example.com", async () => ({
        exitCode: 0,
        stdout: "production",
        stderr: "",
        durationMs: 1,
      })),
    );
    expect(status?.armed).toBe(true);
    expect(status?.reason).toBe("env_type");
  });

  it("pre-2.24 assumeProduction still arms via the companion reason", async () => {
    const guard = new ProdGuard([]);
    const registry = new TargetRegistry(60_000, guard);
    const status = await registry.register(
      fakeTarget("https://old.example.com"),
      { assumeProduction: true },
    );
    expect(status?.armed).toBe(true);
    expect(status?.reason).toBe("companion");
  });
});
