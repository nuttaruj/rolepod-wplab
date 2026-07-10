import { describe, expect, it, vi } from "vitest";
import {
  guardTarget,
  isCatastrophicWpCli,
  isGuardedTarget,
} from "../../src/runtime/wpCliGuard.js";
import type { Target, WpCliResult } from "../../src/runtime/Target.js";

function fakeTarget(): Target & { wpCli: ReturnType<typeof vi.fn> } {
  const wpCli = vi.fn(
    async (): Promise<WpCliResult> => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    }),
  );
  return {
    id: "tgt_abc123",
    kind: "local",
    siteurl: "http://example.test",
    wpVersion: "6.5",
    companion: null,
    wpCli,
    rest: vi.fn(),
    fileRead: vi.fn(),
    fileWrite: vi.fn(),
    fileExists: vi.fn(),
    rootPath: () => "/srv/wp",
    close: vi.fn(),
  } as unknown as Target & { wpCli: ReturnType<typeof vi.fn> };
}

describe("isCatastrophicWpCli", () => {
  it.each([
    [["db", "reset"]],
    [["db", "drop"]],
    [["db", "clean"]],
    [["core", "multisite-convert"]],
  ])("flags %j", (args) => {
    expect(isCatastrophicWpCli(args)).toBe(true);
  });

  it("flags catastrophic commands hidden behind global flags", () => {
    expect(isCatastrophicWpCli(["--yes", "db", "reset"])).toBe(true);
    expect(
      isCatastrophicWpCli(["--path=/srv/wp", "--quiet", "db", "drop"]),
    ).toBe(true);
  });

  it("flags trailing flags and mixed case", () => {
    expect(isCatastrophicWpCli(["DB", "Reset", "--yes"])).toBe(true);
  });

  it("does not flag `eval` — five internal tools depend on it", () => {
    expect(isCatastrophicWpCli(["eval", "echo 1;"])).toBe(false);
  });

  it.each([
    [["db", "query", "SELECT 1"]],
    [["db", "export", "dump.sql"]],
    [["core", "version"]],
    [["plugin", "list"]],
    [[]],
  ])("does not flag %j", (args) => {
    expect(isCatastrophicWpCli(args)).toBe(false);
  });
});

describe("guardTarget", () => {
  it("blocks catastrophic wp-cli regardless of allowDestructive", async () => {
    const raw = fakeTarget();
    const guarded = guardTarget(raw);
    await expect(
      guarded.wpCli(["db", "reset"], { allowDestructive: true }),
    ).rejects.toMatchObject({ code: "WPCLI_BLOCKED" });
    expect(raw.wpCli).not.toHaveBeenCalled();
  });

  it("passes through non-catastrophic wp-cli, including eval", async () => {
    const raw = fakeTarget();
    const guarded = guardTarget(raw);
    await guarded.wpCli(["eval", "echo 1;"]);
    await guarded.wpCli(["plugin", "list"]);
    expect(raw.wpCli).toHaveBeenCalledTimes(2);
  });

  it("preserves non-wpCli members and `this` binding", async () => {
    const raw = fakeTarget();
    const guarded = guardTarget(raw);
    expect(guarded.id).toBe("tgt_abc123");
    expect(guarded.kind).toBe("local");
    expect(guarded.rootPath()).toBe("/srv/wp");
    await guarded.close();
    expect(raw.close).toHaveBeenCalledOnce();
  });

  it("is idempotent", () => {
    const guarded = guardTarget(fakeTarget());
    expect(isGuardedTarget(guarded)).toBe(true);
    expect(guardTarget(guarded)).toBe(guarded);
  });

  it("leaves an unguarded target detectable", () => {
    expect(isGuardedTarget(fakeTarget())).toBe(false);
  });
});
