/**
 * Rolepod Extension Protocol v1 — child evidence emission.
 *
 * The parent `rolepod` plugin (v2.7+) signals its presence by writing a
 * filesystem marker at `<git-root>/.rolepod/parent-active` (UTF-8, one line
 * `v1\n`). The parent's Stop hook removes the marker when no other rolepod
 * sessions hold locks for the same worktree.
 *
 * Why a marker file and NOT an env var: Claude Code SessionStart hooks run
 * in a subprocess. Their env vars cannot propagate to Claude's Bash / MCP
 * tool calls. The marker file IS the cross-subprocess signal — read on
 * demand from inside MCP tool handlers / skill bodies.
 *
 * Manual override (testing / force-on):
 *   mkdir -p .rolepod && echo v1 > .rolepod/parent-active   # force combined
 *   rm -f .rolepod/parent-active                            # force standalone
 *
 * When the marker is absent (standalone), evidence falls back to the legacy
 * `.rolepod-wplab/artifacts/<ts>/` path so existing tools and downstream
 * consumers keep working unchanged.
 *
 * Spec: brief/handoff-wplab-v1.13.0.md.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ParentState {
  active: boolean;
  protocol: string | null;
  gitRoot: string;
}

/**
 * Read the marker file under `<git-root>/.rolepod/parent-active`. Returns
 * `active: true` when present, with the protocol string from line 1 of the
 * marker. Falls back to `cwd` as gitRoot when not inside a git repo.
 */
export function detectRolepodParent(cwd: string = process.cwd()): ParentState {
  let gitRoot = cwd;
  try {
    gitRoot = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // non-git project — keep cwd; marker won't exist anyway
  }

  const file = join(gitRoot, ".rolepod", "parent-active");
  if (!existsSync(file)) {
    return { active: false, protocol: null, gitRoot };
  }

  const protocol = readFileSync(file, "utf8").trim().split(/\r?\n/)[0] ?? "";
  if (protocol !== "v1") {
    // eslint-disable-next-line no-console
    console.warn(
      `rolepod protocol mismatch: expected v1, got "${protocol}" — assuming compatible`,
    );
  }
  return { active: true, protocol, gitRoot };
}

/**
 * Resolve the evidence directory for a skill run.
 *
 *   standalone   →  ./.rolepod-wplab/artifacts/<ts>/
 *   with-parent  →  <git-root>/.rolepod/evidence/<ts>-rolepod-wplab-<skill>/
 *
 * The directory is created (recursive) if missing. The mode flag in the
 * return value lets callers branch on whether to also emit a manifest.
 */
export function resolveEvidenceDir(
  skill: string,
  ts: string,
): { dir: string; mode: "standalone" | "with-parent" } {
  const parent = detectRolepodParent();
  const dir = parent.active
    ? join(parent.gitRoot, ".rolepod", "evidence", `${ts}-rolepod-wplab-${skill}`)
    : join(".rolepod-wplab", "artifacts", ts);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return { dir, mode: parent.active ? "with-parent" : "standalone" };
}

export type RolepodPhase = "verify" | "review" | "debug" | "build";
export type RolepodStatus = "pass" | "fail" | "warn";

export interface ManifestInput {
  skill: string;
  phase: RolepodPhase;
  status: RolepodStatus;
  /** One-line human-readable summary. */
  summary: string;
  /** ISO 8601 timestamps. */
  startedAt: string;
  finishedAt: string;
  /** Files produced by this skill run, relative to the evidence dir. */
  artifacts: Array<{ type: string; path: string }>;
  /** Free-form domain metadata (e.g. {wp_version, php_version, plugin_count}). */
  metadata?: Record<string, unknown>;
}

/**
 * Write the `manifest.json` file the parent's phase orchestrator reads.
 * Only meaningful when `detectRolepodParent().active === true` — callers
 * MUST check before invoking (a manifest written in standalone mode is
 * harmless but pointless).
 */
export function writeManifest(dir: string, input: ManifestInput): void {
  const manifest = {
    protocol: "rolepod/v1",
    plugin: "rolepod-wplab",
    skill: input.skill,
    phase: input.phase,
    status: input.status,
    summary: input.summary,
    started_at: input.startedAt,
    finished_at: input.finishedAt,
    artifacts: input.artifacts,
    metadata: input.metadata ?? {},
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

/**
 * Convenience: build a UTC timestamp suitable for evidence dir names.
 * Format: 20260528T134522Z
 */
export function makeRunTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}
