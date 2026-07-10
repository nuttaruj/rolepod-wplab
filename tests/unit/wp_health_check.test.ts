import { describe, expect, it, vi } from "vitest";
import { wpHealthCheckHandler } from "../../src/tools/atomic/wp_health_check.js";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

/** `cli version` → ok, `option get siteurl` → siteurl, `eval` → envType. */
function fakeRegistry(siteurl: string, envType: string) {
  const target = {
    id: "tgt_health00",
    kind: "local" as const,
    siteurl,
    wpVersion: "6.5",
    companion: null,
    wpCli: vi.fn(async (args: readonly string[]) => {
      const stdout =
        args[0] === "eval"
          ? envType
          : args[0] === "option"
            ? siteurl
            : "2.12.0";
      return { exitCode: 0, stdout, stderr: "", durationMs: 1 };
    }),
    rootPath: () => "/srv/wp",
    close: vi.fn(),
  };
  return {
    registry: { get: vi.fn(() => target) } as unknown as TargetRegistry,
    target,
  };
}

const INPUT = { target_id: "tgt_health00" };

describe("wpHealthCheckHandler — production guard", () => {
  it("reports armed and warns about nothing when the site says production", async () => {
    const { registry } = fakeRegistry("https://live.test", "production");
    const out = await wpHealthCheckHandler(registry, new ProdGuard([]), INPUT);
    expect(out.prod_guard).toEqual({
      armed: true,
      env_type: "production",
      reason: "env_type",
    });
    expect(out.warnings.join(" ")).not.toMatch(/DISARMED/);
  });

  it("warns loudly when the guard is disarmed", async () => {
    const { registry } = fakeRegistry("http://localhost:8080", "");
    const out = await wpHealthCheckHandler(registry, new ProdGuard([]), INPUT);
    expect(out.prod_guard).toMatchObject({ armed: false, reason: "unset" });
    expect(out.warnings.join(" ")).toMatch(/production guard is DISARMED/);
  });

  it("reports armed via host pattern too", async () => {
    const { registry } = fakeRegistry("https://a.prod.test", "staging");
    const out = await wpHealthCheckHandler(
      registry,
      new ProdGuard(["*.prod.test"]),
      INPUT,
    );
    expect(out.prod_guard).toMatchObject({
      armed: true,
      reason: "host_pattern",
    });
  });
});
