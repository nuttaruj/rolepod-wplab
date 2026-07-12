import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor, type CompanionBridge } from "../../companion/Bridge.js";
import {
  DEFAULT_CHUNK,
  downloadBackup,
  importBackup,
} from "../../companion/backupTransfer.js";
import {
  MigrateSiteInputSchema,
  MigrateSiteOutputSchema,
  type MigrateSiteInput,
  type MigrateSiteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 900_000; // 15 min per async stage

export const wpMigrateSiteToolDef = {
  name: "rolepod_wp_migrate_site",
  description:
    "Migrate a full WordPress site host-to-host, REST↔REST (both targets need the rolepod-wp companion v2.23+). Orchestration, in order: (0) MANDATORY back up the DESTINATION first — its id is your rollback pointer; (1) snapshot the SOURCE; (2) pull the source archive down to this host; (3) push it into the destination; (4) restore it on the destination with a serialized-safe URL rewrite (source host → dest host). DESTRUCTIVE: this OVERWRITES the destination's db + wp-content with the source. Production destinations require confirm=true (else PRODUCTION_BLOCKED). Shell targets are unsupported — use rolepod_wp_clone for shell↔shell. Each async stage is bounded by timeout_ms (default 15 min); a timeout surfaces the dest rollback id.",
  inputSchema: MigrateSiteInputSchema,
};

function requireRestCompanion(t: Target, label: string): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "MIGRATE_UNSUPPORTED_TARGET",
      `wp_migrate_site is REST↔REST only — ${label} target kind=${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"}). For shell↔shell use rolepod_wp_clone.`,
      { label, kind: t.kind },
    );
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start a backup on `bridge`, then poll until it finishes. Returns the completed
 * backup's id (captured at start — the engine records history under that same
 * id). Throws on a start rejection, an errored job, or a timeout.
 */
async function backupAndWait(
  bridge: CompanionBridge,
  components: Record<string, boolean>,
  deadline: number,
  role: "dest" | "source",
): Promise<string> {
  const failCode =
    role === "dest"
      ? "MIGRATE_DEST_BACKUP_FAILED"
      : "MIGRATE_SOURCE_BACKUP_FAILED";
  const started = await bridge.backupStart({
    components,
    compress: true,
    exclude: [],
  });
  if (started["ok"] !== true) {
    throw new WplabError(
      failCode,
      `${role} backup did not start: ${String(started["error"] ?? "unknown")}`,
      { role, response: started },
    );
  }
  const job = (started["job"] ?? {}) as Record<string, unknown>;
  const id = String(job["id"] ?? "");
  if (!id) {
    throw new WplabError(failCode, `${role} backup returned no id`, {
      role,
      response: started,
    });
  }
  for (;;) {
    const st = ((await bridge.backupStatus())["job"] ?? {}) as Record<
      string,
      unknown
    >;
    const status = String(st["status"] ?? "");
    if (status === "done") return id;
    if (status === "error") {
      throw new WplabError(
        failCode,
        `${role} backup errored: ${String(st["error"] ?? "unknown")}`,
        { role, status: st },
      );
    }
    if (Date.now() > deadline) {
      throw new WplabError(
        "MIGRATE_TIMEOUT",
        `${role} backup did not finish within the timeout`,
        { role, status: st },
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Start a restore on `bridge` for backup `id`, then poll until it finishes.
 * Throws on a start rejection, an errored job, or a timeout.
 */
async function restoreAndWait(
  bridge: CompanionBridge,
  id: string,
  searchReplace: Record<string, string>,
  deadline: number,
): Promise<void> {
  const started = await bridge.restoreStart({
    id,
    confirm: true,
    components: { db: true, files: true },
    ...(Object.keys(searchReplace).length
      ? { search_replace: searchReplace }
      : {}),
  });
  if (started["ok"] !== true) {
    throw new WplabError(
      "MIGRATE_RESTORE_FAILED",
      `restore did not start: ${String(started["error"] ?? started["error_code"] ?? "unknown")}`,
      { response: started },
    );
  }
  for (;;) {
    const st = ((await bridge.restoreStatus())["job"] ?? {}) as Record<
      string,
      unknown
    >;
    const status = String(st["status"] ?? "");
    if (status === "done") return;
    if (status === "error") {
      throw new WplabError(
        "MIGRATE_RESTORE_FAILED",
        `restore errored: ${String(st["error"] ?? "unknown")}`,
        { status: st },
      );
    }
    if (Date.now() > deadline) {
      throw new WplabError(
        "MIGRATE_TIMEOUT",
        "restore did not finish within the timeout",
        { status: st },
      );
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function wpMigrateSiteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<MigrateSiteOutput> {
  const input: MigrateSiteInput = MigrateSiteInputSchema.parse(raw);
  const source = registry.get(input.source_target_id);
  const dest = registry.get(input.dest_target_id);
  requireRestCompanion(source, "source");
  requireRestCompanion(dest, "dest");

  // Production gate BEFORE any mutation — this tool overwrites the destination.
  const matched = prodGuard.matches(dest.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "wp_migrate_site dest is production-matched; pass confirm=true to proceed (this OVERWRITES the destination)",
      { dest_siteurl: dest.siteurl, matchedPattern: matched.pattern },
    );
  }

  const components = {
    db: input.components?.db ?? true,
    uploads: input.components?.uploads ?? true,
    themes: input.components?.themes ?? true,
    plugins: input.components?.plugins ?? true,
    muplugins: input.components?.muplugins ?? true,
  };
  const chunkBytes = input.chunk_bytes ?? DEFAULT_CHUNK;
  const timeoutMs = input.timeout_ms ?? DEFAULT_TIMEOUT_MS;

  const sourceBridge = await bridgeFor(source);
  const destBridge = await bridgeFor(dest);

  const runId = makeRunId();
  const steps: MigrateSiteOutput["steps"] = [];
  const workPath =
    input.work_path ?? join(tmpdir(), `wplab-migrate-${runId}.zip`);

  // Step 0 — MANDATORY: back up the DEST first. RestoreEngine does not snapshot,
  // so without this an interrupted restore leaves the destination half-migrated
  // with no rollback. A failure here means the dest was never touched (safe).
  const destRollbackId = await backupAndWait(
    destBridge,
    components,
    Date.now() + timeoutMs,
    "dest",
  );
  steps.push({
    step: "backup_dest",
    ok: true,
    detail: `rollback id ${destRollbackId}`,
  });

  let sourceBackupId = "";
  try {
    // Step 1 — snapshot the SOURCE.
    sourceBackupId = await backupAndWait(
      sourceBridge,
      components,
      Date.now() + timeoutMs,
      "source",
    );
    steps.push({
      step: "backup_source",
      ok: true,
      detail: `source id ${sourceBackupId}`,
    });

    // Step 2 — pull the source archive down to this host.
    const dl = await downloadBackup(
      sourceBridge,
      sourceBackupId,
      workPath,
      chunkBytes,
    );
    if (!dl.ok) {
      throw new WplabError(
        "MIGRATE_DOWNLOAD_INCOMPLETE",
        `source download incomplete: ${dl.bytes}/${dl.total_bytes} bytes`,
        { download: dl },
      );
    }
    steps.push({
      step: "download_source",
      ok: true,
      detail: `${dl.bytes} bytes → ${workPath}`,
    });

    // Step 3 — push the archive into the DEST (validated + registered there).
    const imp = await importBackup(destBridge, workPath, chunkBytes);
    const importedId = String(imp["id"] ?? "");
    if (imp["ok"] !== true || !importedId) {
      throw new WplabError(
        "MIGRATE_IMPORT_FAILED",
        `import into dest failed: ${String(imp["error_code"] ?? imp["error"] ?? "unknown")}`,
        { response: imp },
      );
    }
    steps.push({
      step: "import_to_dest",
      ok: true,
      detail: `imported id ${importedId}`,
    });

    // Step 4 — restore the imported archive on the DEST, rewriting the source
    // host → dest host (serialized-safe, companion-side).
    const searchReplace: Record<string, string> = {};
    const sourceHost = hostOf(source.siteurl);
    const destHost = hostOf(dest.siteurl);
    if (sourceHost && destHost && sourceHost !== destHost) {
      searchReplace[sourceHost] = destHost;
    }
    await restoreAndWait(
      destBridge,
      importedId,
      searchReplace,
      Date.now() + timeoutMs,
    );
    steps.push({
      step: "restore_dest",
      ok: true,
      detail: Object.keys(searchReplace).length
        ? `search-replace ${sourceHost} → ${destHost}`
        : "same host — no url rewrite",
    });
  } catch (err) {
    // Any failure after step 0 leaves the dest possibly overwritten — always
    // surface the rollback id (and the steps so far) so the operator can restore.
    const e = err as WplabError & {
      code?: string;
      meta?: Record<string, unknown>;
    };
    throw new WplabError(e.code ?? "MIGRATE_FAILED", e.message, {
      ...e.meta,
      dest_rollback_backup_id: destRollbackId,
      steps,
    });
  } finally {
    // Best-effort cleanup of the host-side staging archive.
    await rm(workPath, { force: true }).catch(() => {});
  }

  const artifactDir = join(process.cwd(), ".rolepod-wplab", "artifacts", runId);
  await mkdir(artifactDir, { recursive: true });
  const reportPath = join(artifactDir, "migrate-site-report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        run_id: runId,
        source: source.siteurl,
        dest: dest.siteurl,
        dest_rollback_backup_id: destRollbackId,
        source_backup_id: sourceBackupId,
        steps,
      },
      null,
      2,
    ),
    "utf8",
  );

  return MigrateSiteOutputSchema.parse({
    run_id: runId,
    ok: true,
    dest_rollback_backup_id: destRollbackId,
    source_backup_id: sourceBackupId,
    steps,
    report_path: reportPath,
  });
}
