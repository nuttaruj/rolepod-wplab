import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, rmSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  detectRolepodParent,
  resolveEvidenceDir,
  writeManifest,
  makeRunTimestamp,
} from "../../src/lib/rolepodEvidence.js";

describe("rolepodEvidence — Extension Protocol v1 (marker-file)", () => {
  let cwd: string;
  let prev: { cwd: string };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "rolepod-evidence-"));
    // init a real git repo so git rev-parse --show-toplevel works
    execSync("git init -q", { cwd });
    execSync("git config user.email t@t", { cwd });
    execSync("git config user.name t", { cwd });
    prev = { cwd: process.cwd() };
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(prev.cwd);
    rmSync(cwd, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("detectRolepodParent: marker absent → active=false", () => {
    const s = detectRolepodParent();
    expect(s.active).toBe(false);
    expect(s.protocol).toBeNull();
    // gitRoot resolves to the temp dir (may go through /private on macOS — match suffix)
    expect(s.gitRoot.endsWith(cwd.replace(/^\/private/, ""))).toBe(true);
  });

  it("detectRolepodParent: marker present + v1 → active=true", () => {
    mkdirSync(join(cwd, ".rolepod"), { recursive: true });
    writeFileSync(join(cwd, ".rolepod", "parent-active"), "v1\n");
    const s = detectRolepodParent();
    expect(s.active).toBe(true);
    expect(s.protocol).toBe("v1");
  });

  it("detectRolepodParent: warns on protocol mismatch but stays active", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mkdirSync(join(cwd, ".rolepod"), { recursive: true });
    writeFileSync(join(cwd, ".rolepod", "parent-active"), "v2\n");
    const s = detectRolepodParent();
    expect(s.active).toBe(true);
    expect(s.protocol).toBe("v2");
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]?.[0]).toMatch(/protocol mismatch/);
  });

  it("detectRolepodParent: ignores ROLEPOD_PARENT env var", () => {
    const prevEnv = process.env.ROLEPOD_PARENT;
    process.env.ROLEPOD_PARENT = "1";
    try {
      const s = detectRolepodParent();
      expect(s.active).toBe(false); // env-var path must not affect detection
    } finally {
      if (prevEnv !== undefined) process.env.ROLEPOD_PARENT = prevEnv;
      else delete process.env.ROLEPOD_PARENT;
    }
  });

  it("detectRolepodParent: non-git project falls back to cwd", () => {
    const nogit = mkdtempSync(join(tmpdir(), "rolepod-nogit-"));
    try {
      const s = detectRolepodParent(nogit);
      expect(s.active).toBe(false);
      expect(s.gitRoot).toBe(nogit);
    } finally {
      rmSync(nogit, { recursive: true, force: true });
    }
  });

  it("resolveEvidenceDir: standalone path under cwd-relative .rolepod-wplab/", () => {
    const { dir, mode } = resolveEvidenceDir("wp-health-check", "20260528T120000Z");
    expect(mode).toBe("standalone");
    expect(dir).toBe(join(".rolepod-wplab", "artifacts", "20260528T120000Z"));
    expect(existsSync(join(cwd, dir))).toBe(true);
  });

  it("resolveEvidenceDir: with-parent path is git-root-absolute", () => {
    mkdirSync(join(cwd, ".rolepod"), { recursive: true });
    writeFileSync(join(cwd, ".rolepod", "parent-active"), "v1\n");
    const { dir, mode } = resolveEvidenceDir("wp-changes", "20260528T120000Z");
    expect(mode).toBe("with-parent");
    // dir is absolute, ends with the expected suffix
    expect(dir.endsWith(join(".rolepod", "evidence", "20260528T120000Z-rolepod-wplab-wp-changes"))).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });

  it("resolveEvidenceDir: with-parent invoked from subdir still lands at git root", () => {
    mkdirSync(join(cwd, ".rolepod"), { recursive: true });
    writeFileSync(join(cwd, ".rolepod", "parent-active"), "v1\n");
    const sub = join(cwd, "deep", "nested");
    mkdirSync(sub, { recursive: true });
    process.chdir(sub);
    const { dir, mode } = resolveEvidenceDir("wp-health-check", "20260528T120001Z");
    expect(mode).toBe("with-parent");
    expect(dir.startsWith(cwd) || dir.startsWith("/private" + cwd)).toBe(true);
    expect(dir).toContain(join(".rolepod", "evidence", "20260528T120001Z-rolepod-wplab-wp-health-check"));
  });

  it("writeManifest emits valid Protocol v1 JSON", () => {
    mkdirSync(join(cwd, ".rolepod"), { recursive: true });
    writeFileSync(join(cwd, ".rolepod", "parent-active"), "v1\n");
    const { dir } = resolveEvidenceDir("wp-health-check", "20260528T120000Z");
    writeManifest(dir, {
      skill: "wp-health-check",
      phase: "verify",
      status: "pass",
      summary: "WP 7.0, PHP 8.2, 23 plugins active",
      startedAt: "2026-05-28T12:00:00Z",
      finishedAt: "2026-05-28T12:00:02Z",
      artifacts: [{ type: "report", path: "./health.json" }],
      metadata: { wp_version: "7.0", php_version: "8.2.10", plugin_count: 23 },
    });
    const raw = readFileSync(join(dir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.protocol).toBe("rolepod/v1");
    expect(parsed.plugin).toBe("rolepod-wplab");
    expect(parsed.skill).toBe("wp-health-check");
    expect(parsed.phase).toBe("verify");
    expect(parsed.status).toBe("pass");
    expect(parsed.metadata.wp_version).toBe("7.0");
    expect(parsed.artifacts[0].path).toBe("./health.json");
    // start/finish keys must use snake_case in the file
    expect(parsed.started_at).toBe("2026-05-28T12:00:00Z");
    expect(parsed.finished_at).toBe("2026-05-28T12:00:02Z");
    expect(parsed.startedAt).toBeUndefined();
    expect(parsed.finishedAt).toBeUndefined();
  });

  it("makeRunTimestamp produces ISO-compact UTC string", () => {
    const ts = makeRunTimestamp();
    expect(ts).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
