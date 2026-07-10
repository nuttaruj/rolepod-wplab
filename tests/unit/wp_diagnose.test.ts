import { describe, expect, it, vi } from "vitest";
import { wpDiagnoseHandler } from "../../src/tools/composite/wp_diagnose.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

/** `option get` succeeds; every other wp-cli call throws. */
function fakeRegistry(failing: (args: readonly string[]) => boolean) {
  const target = {
    id: "tgt_diagnose",
    kind: "local" as const,
    siteurl: "http://x.test",
    wpVersion: "6.5",
    companion: null,
    wpCli: vi.fn(async (args: readonly string[]) => {
      if (failing(args)) throw new Error("probe exploded");
      return { exitCode: 0, stdout: "[]", stderr: "", durationMs: 1 };
    }),
    rest: vi.fn(async () => ({ status: 200, body: [], headers: {} })),
    fileRead: vi.fn(async () => ({
      content: "",
      bytes: 0,
      absolutePath: "/x",
    })),
    fileExists: vi.fn(async () => false),
    rootPath: () => "/srv/wp",
    close: vi.fn(),
  };
  return { get: vi.fn(() => target) } as unknown as TargetRegistry;
}

describe("wpDiagnoseHandler — a failing probe degrades, it does not abort", () => {
  it("turns a thrown probe into a warn finding and keeps going", async () => {
    const registry = fakeRegistry((args) => args[0] === "plugin");
    const out = await wpDiagnoseHandler(registry, {
      target_id: "tgt_diagnose",
      scopes: ["plugin_conflict_probe", "large_options"],
    });

    const failed = out.findings.find(
      (f) => f.scope === "plugin_conflict_probe",
    );
    expect(failed).toMatchObject({
      severity: "warn",
      detail: { probe_failed: true },
    });
    expect(failed?.message).toMatch(/was NOT checked/);
  });

  it("does not reject when every scope fails", async () => {
    const registry = fakeRegistry(() => true);
    const out = await wpDiagnoseHandler(registry, {
      target_id: "tgt_diagnose",
      scopes: ["plugin_conflict_probe", "slow_queries"],
    });
    expect(out.findings.filter((f) => f.severity === "warn").length).toBe(2);
  });
});
