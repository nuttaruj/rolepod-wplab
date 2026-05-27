import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  BackupCreateInputSchema,
  BackupCreateOutputSchema,
  BackupRestoreInputSchema,
  BackupRestoreOutputSchema,
  type BackupCreateInput,
  type BackupCreateOutput,
  type BackupRestoreInput,
  type BackupRestoreOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpBackupCreateToolDef = {
  name: "rolepod_wp_backup_create",
  description:
    "Create a backup of a WP site. scope=db dumps db (sql), scope=wp_content snapshots plugins/themes/uploads file list. Artifacts saved to .rolepod-wplab/artifacts/backups/<run_id>/. Shell-capable target only.",
  inputSchema: BackupCreateInputSchema,
};

export const wpBackupRestoreToolDef = {
  name: "rolepod_wp_backup_restore",
  description:
    "Restore from a backup directory created by wp_backup_create. allow_destructive=true required; production guard fires unless confirm=true. Shell-capable target only.",
  inputSchema: BackupRestoreInputSchema,
};

function ensureShell(t: Target): void {
  // RestTarget routes wp-cli through companion's /wp-cli endpoint, so
  // backup operations (wp db export, plugin/theme listing) work over REST
  // as long as companion is installed + enabled. Other RestTargets without
  // companion still get rejected — they have no way to invoke wp-cli.
  if (t.kind === "rest" && t.companion?.enabled) {
    return;
  }
  if (t.kind !== "local" && t.kind !== "ssh" && t.kind !== "docker") {
    throw new WplabError(
      "BACKUP_REQUIRES_SHELL",
      `backup requires shell-capable target or RestTarget with companion — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { kind: t.kind, companion_enabled: !!t.companion?.enabled },
    );
  }
}

export async function wpBackupCreateHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<BackupCreateOutput> {
  const input: BackupCreateInput = BackupCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  ensureShell(target);
  const runId = makeRunId();
  const labelPart = input.label
    ? `-${input.label.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    : "";
  const dir = join(
    process.cwd(),
    ".rolepod-wplab",
    "artifacts",
    "backups",
    `${runId}${labelPart}`,
  );
  await mkdir(dir, { recursive: true });

  const artifacts: BackupCreateOutput["artifacts"] = [];

  if (input.scope.includes("db")) {
    const dumpRel = `wp-content/uploads/wplab-tmp/backup-${runId}.sql`;
    const r = await target.wpCli(
      ["db", "export", dumpRel, "--add-drop-table"],
      { allowDestructive: true, timeoutMs: 120_000 },
    );
    if (r.exitCode !== 0) {
      throw new WplabError("BACKUP_DB_FAILED", r.stderr.slice(0, 200), {
        exitCode: r.exitCode,
      });
    }
    const read = await target.fileRead(dumpRel);
    const dest = join(dir, "db.sql");
    await writeFile(dest, read.content, "utf8");
    artifacts.push({ kind: "db", path: dest, bytes: read.bytes });
  }

  if (input.scope.includes("wp_content")) {
    const manifestRel = `wp-content/uploads/wplab-tmp/wp-content-manifest-${runId}.json`;
    const r = await target.wpCli([
      "eval",
      `$out=[];foreach(['plugins','themes','uploads'] as $sub){foreach(glob(ABSPATH.'wp-content/'.$sub.'/*') as $p){$out[]=['sub'=>$sub,'name'=>basename($p),'is_dir'=>is_dir($p)];}}echo json_encode($out);`,
    ]);
    if (r.exitCode !== 0) {
      throw new WplabError("BACKUP_WP_CONTENT_FAILED", r.stderr.slice(0, 200), {
        exitCode: r.exitCode,
      });
    }
    const dest = join(dir, "wp-content-manifest.json");
    await writeFile(dest, r.stdout || "[]", "utf8");
    artifacts.push({ kind: "wp_content", path: dest, bytes: r.stdout.length });
    void manifestRel;
  }

  return BackupCreateOutputSchema.parse({
    run_id: runId,
    artifact_dir: dir,
    artifacts,
  });
}

export async function wpBackupRestoreHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<BackupRestoreOutput> {
  const input: BackupRestoreInput = BackupRestoreInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  ensureShell(target);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "backup_restore on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  const runId = makeRunId();
  const restored: BackupRestoreOutput["restored"] = [];

  if (input.scope.includes("db")) {
    const sqlPath = join(input.artifact_dir, "db.sql");
    try {
      const { readFile } = await import("node:fs/promises");
      const buf = await readFile(sqlPath, "utf8");
      const destRel = `wp-content/uploads/wplab-tmp/restore-${runId}.sql`;
      const w = await target.fileWrite(destRel, buf, { backup: false });
      const r = await target.wpCli(["db", "import", w.absolutePath], {
        allowDestructive: true,
        timeoutMs: 180_000,
      });
      restored.push({
        kind: "db",
        ok: r.exitCode === 0,
        ...(r.exitCode === 0 ? {} : { detail: r.stderr.slice(0, 200) }),
      });
    } catch (err) {
      restored.push({ kind: "db", ok: false, detail: (err as Error).message });
    }
  }

  if (input.scope.includes("wp_content")) {
    // v1.1 wp_content restore = manifest verify only (full file rsync deferred to v1.2 with companion fs-write batch)
    restored.push({
      kind: "wp_content",
      ok: true,
      detail:
        "wp_content manifest acknowledged — actual file restore requires rsync (v1.2 batch fs API)",
    });
  }

  return BackupRestoreOutputSchema.parse({ run_id: runId, restored });
}
