/**
 * Rolepod Extension Protocol v1 — child evidence emission.
 *
 * The parent `rolepod` plugin (v2.7+) sets `ROLEPOD_PARENT=1` and
 * `ROLEPOD_PROTOCOL=v1` via its SessionStart hook. When that flag is set,
 * phase-flavored child skills (wp-health-check, wp-changes, etc.) should
 * write their structured findings to the parent's evidence directory using
 * the manifest.json schema below so the parent's phase orchestrator
 * (check-work, review-code, debug-issue) can consume them.
 *
 * When the flag is absent (standalone use), evidence falls back to the
 * legacy `.rolepod-wplab/artifacts/<ts>/` path so existing tools and
 * downstream consumers keep working unchanged.
 *
 * Spec: brief/handoff-wplab-v1.9.md (shipped here as v1.12).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** True when running under the rolepod parent (v2.7+). */
export function isUnderRolepodParent(): boolean {
  return process.env.ROLEPOD_PARENT === "1";
}

export function rolepodProtocolVersion(): string | null {
  return process.env.ROLEPOD_PROTOCOL ?? null;
}

/**
 * Resolve the evidence directory for a skill run.
 *
 *   standalone   →  .rolepod-wplab/artifacts/<ts>/
 *   with-parent  →  .rolepod/evidence/<ts>-rolepod-wplab-<skill>/
 *
 * The directory is created (recursive) if missing.
 */
export function resolveEvidenceDir(skill: string, ts: string): string {
  const base = isUnderRolepodParent()
    ? join(".rolepod", "evidence", `${ts}-rolepod-wplab-${skill}`)
    : join(".rolepod-wplab", "artifacts", ts);
  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }
  return base;
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
 * Only meaningful when `isUnderRolepodParent()` returns true — callers
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
 * Format: 20260527T134522Z
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
