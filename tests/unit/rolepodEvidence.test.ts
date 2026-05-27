import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
  isUnderRolepodParent,
  resolveEvidenceDir,
  writeManifest,
  makeRunTimestamp,
  rolepodProtocolVersion,
} from "../../src/lib/rolepodEvidence.js";

describe("rolepodEvidence — Extension Protocol v1", () => {
  let cwd: string;
  let prev: { cwd: string; parent?: string; protocol?: string };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "rolepod-evidence-"));
    prev = {
      cwd: process.cwd(),
      parent: process.env.ROLEPOD_PARENT,
      protocol: process.env.ROLEPOD_PROTOCOL,
    };
    process.chdir(cwd);
    delete process.env.ROLEPOD_PARENT;
    delete process.env.ROLEPOD_PROTOCOL;
  });

  afterEach(() => {
    process.chdir(prev.cwd);
    if (prev.parent !== undefined) process.env.ROLEPOD_PARENT = prev.parent;
    else delete process.env.ROLEPOD_PARENT;
    if (prev.protocol !== undefined) process.env.ROLEPOD_PROTOCOL = prev.protocol;
    else delete process.env.ROLEPOD_PROTOCOL;
    rmSync(cwd, { recursive: true, force: true });
  });

  it("isUnderRolepodParent returns false when env unset", () => {
    expect(isUnderRolepodParent()).toBe(false);
  });

  it("isUnderRolepodParent returns true only on exact '1'", () => {
    process.env.ROLEPOD_PARENT = "1";
    expect(isUnderRolepodParent()).toBe(true);
    process.env.ROLEPOD_PARENT = "true";
    expect(isUnderRolepodParent()).toBe(false);
    process.env.ROLEPOD_PARENT = "yes";
    expect(isUnderRolepodParent()).toBe(false);
  });

  it("rolepodProtocolVersion echoes env var", () => {
    expect(rolepodProtocolVersion()).toBeNull();
    process.env.ROLEPOD_PROTOCOL = "v1";
    expect(rolepodProtocolVersion()).toBe("v1");
  });

  it("resolveEvidenceDir standalone path", () => {
    const dir = resolveEvidenceDir("wp-health-check", "20260527T120000Z");
    expect(dir).toBe(join(".rolepod-wplab", "artifacts", "20260527T120000Z"));
    expect(existsSync(join(cwd, dir))).toBe(true);
  });

  it("resolveEvidenceDir with-parent path", () => {
    process.env.ROLEPOD_PARENT = "1";
    const dir = resolveEvidenceDir("wp-changes", "20260527T120000Z");
    expect(dir).toBe(
      join(".rolepod", "evidence", "20260527T120000Z-rolepod-wplab-wp-changes"),
    );
    expect(existsSync(join(cwd, dir))).toBe(true);
  });

  it("writeManifest emits valid Protocol v1 JSON", () => {
    process.env.ROLEPOD_PARENT = "1";
    const dir = resolveEvidenceDir("wp-health-check", "20260527T120000Z");
    writeManifest(dir, {
      skill: "wp-health-check",
      phase: "verify",
      status: "pass",
      summary: "WP 7.0, PHP 8.2, 23 plugins active",
      startedAt: "2026-05-27T12:00:00Z",
      finishedAt: "2026-05-27T12:00:02Z",
      artifacts: [{ type: "report", path: "./health.json" }],
      metadata: { wp_version: "7.0", php_version: "8.2.10", plugin_count: 23 },
    });
    const raw = readFileSync(join(cwd, dir, "manifest.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.protocol).toBe("rolepod/v1");
    expect(parsed.plugin).toBe("rolepod-wplab");
    expect(parsed.skill).toBe("wp-health-check");
    expect(parsed.phase).toBe("verify");
    expect(parsed.status).toBe("pass");
    expect(parsed.metadata.wp_version).toBe("7.0");
    expect(parsed.artifacts[0].path).toBe("./health.json");
    // start/finish keys must use snake_case in the file
    expect(parsed.started_at).toBe("2026-05-27T12:00:00Z");
    expect(parsed.finished_at).toBe("2026-05-27T12:00:02Z");
    expect(parsed.startedAt).toBeUndefined();
    expect(parsed.finishedAt).toBeUndefined();
  });

  it("makeRunTimestamp produces ISO-compact UTC string", () => {
    const ts = makeRunTimestamp();
    expect(ts).toMatch(/^\d{8}T\d{6}Z$/);
  });
});
