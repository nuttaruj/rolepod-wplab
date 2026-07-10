import { describe, expect, it, vi } from "vitest";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import { armProdGuard } from "../../src/safety/detectProduction.js";
import { TargetRegistry } from "../../src/target/TargetRegistry.js";
import type { Target } from "../../src/runtime/Target.js";

function fakeTarget(
  siteurl: string,
  wpCliImpl: () => Promise<{ exitCode: number; stdout: string }>,
): Target {
  return {
    id: "tgt_envprobe",
    kind: "local",
    siteurl,
    wpVersion: "6.5",
    companion: null,
    wpCli: vi.fn(async () => ({
      stderr: "",
      durationMs: 1,
      ...(await wpCliImpl()),
    })),
    rest: vi.fn(),
    fileRead: vi.fn(),
    fileWrite: vi.fn(),
    fileExists: vi.fn(),
    rootPath: () => "/srv/wp",
    close: vi.fn(async () => undefined),
  } as unknown as Target;
}

const echo = (stdout: string) => async () => ({ exitCode: 0, stdout });

describe("ProdGuard.markProduction", () => {
  it("arms the guard for the marked host only", () => {
    const guard = new ProdGuard([]);
    expect(guard.markProduction("https://live.example.com")).toBe(true);
    expect(guard.isArmedFor("https://live.example.com")).toBe(true);
    expect(guard.isArmedFor("https://staging.example.com")).toBe(false);
  });

  it("reports why it matched", () => {
    const guard = new ProdGuard([]);
    guard.markProduction("https://live.example.com/wp");
    expect(guard.matches("https://live.example.com")).toEqual({
      matched: true,
      pattern: "live.example.com (WP_ENVIRONMENT_TYPE)",
    });
  });

  it("leaves existing host patterns working", () => {
    const guard = new ProdGuard(["*.prod.test"]);
    guard.markProduction("https://other.test");
    expect(guard.matches("https://a.prod.test").matched).toBe(true);
    expect(guard.isArmedFor("https://other.test")).toBe(true);
    expect(guard.isArmedFor("https://b.dev.test")).toBe(false);
  });

  it("returns false for an unparseable siteurl", () => {
    expect(new ProdGuard([]).markProduction("not a url")).toBe(false);
  });
});

describe("armProdGuard — raw WP_ENVIRONMENT_TYPE", () => {
  it("arms on production", async () => {
    const guard = new ProdGuard([]);
    const status = await armProdGuard(
      fakeTarget("https://live.test", echo("production")),
      guard,
    );
    expect(status).toEqual({
      env_type: "production",
      armed: true,
      reason: "env_type",
    });
  });

  it("stays DISARMED when the signal is unset", async () => {
    // WordPress' own wp_get_environment_type() returns 'production' here.
    // Trusting it would arm the guard on every unconfigured local install.
    const guard = new ProdGuard([]);
    const status = await armProdGuard(
      fakeTarget("http://localhost:8080", echo("")),
      guard,
    );
    expect(status).toEqual({ env_type: "", armed: false, reason: "unset" });
  });

  it("stays disarmed on staging/local/development", async () => {
    for (const env of ["staging", "local", "development"]) {
      const guard = new ProdGuard([]);
      const status = await armProdGuard(
        fakeTarget("https://x.test", echo(env)),
        guard,
      );
      expect(status).toEqual({
        env_type: env,
        armed: false,
        reason: "not_production",
      });
    }
  });

  it("reports probe_failed without throwing when wp-cli is unreachable", async () => {
    const guard = new ProdGuard([]);
    const status = await armProdGuard(
      fakeTarget("https://x.test", () => {
        throw new Error("COMPANION_REQUIRED_V0_2");
      }),
      guard,
    );
    expect(status).toEqual({
      env_type: null,
      armed: false,
      reason: "probe_failed",
    });
  });

  it("reports probe_failed on a non-zero exit", async () => {
    const guard = new ProdGuard([]);
    const status = await armProdGuard(
      fakeTarget("https://x.test", async () => ({ exitCode: 1, stdout: "" })),
      guard,
    );
    expect(status.reason).toBe("probe_failed");
    expect(status.armed).toBe(false);
  });

  it("still reports armed via host pattern when the probe fails", async () => {
    const guard = new ProdGuard(["x.test"]);
    const status = await armProdGuard(
      fakeTarget("https://x.test", async () => ({ exitCode: 1, stdout: "" })),
      guard,
    );
    expect(status).toEqual({
      env_type: null,
      armed: true,
      reason: "host_pattern",
    });
  });
});

describe("TargetRegistry.register — arms the guard on every path", () => {
  it("arms from the environment probe", async () => {
    const guard = new ProdGuard([]);
    const reg = new TargetRegistry(60_000, guard);
    const status = await reg.register(
      fakeTarget("https://live.test", echo("production")),
    );
    expect(status).toMatchObject({ armed: true, reason: "env_type" });
    expect(guard.isArmedFor("https://live.test")).toBe(true);
  });

  it("arms from assumeProduction when the probe cannot run", async () => {
    const guard = new ProdGuard([]);
    const reg = new TargetRegistry(60_000, guard);
    const status = await reg.register(
      fakeTarget("https://paired.test", () => {
        throw new Error("no wp-cli over REST");
      }),
      { assumeProduction: true },
    );
    expect(status).toMatchObject({ armed: true, reason: "companion" });
    expect(guard.isArmedFor("https://paired.test")).toBe(true);
  });

  it("returns null when the registry has no ProdGuard", async () => {
    const reg = new TargetRegistry(60_000);
    expect(await reg.register(fakeTarget("https://x.test", echo("")))).toBe(
      null,
    );
  });
});
