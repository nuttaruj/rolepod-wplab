import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { bridgeFor, type CompanionBridge } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpSiteBackupInputSchema,
  WpSiteBackupOutputSchema,
  type WpSiteBackupInput,
  type WpSiteBackupOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

const DEFAULT_CHUNK = 1_048_576;

/**
 * Pull an archive from WordPress to a local path, chunk by chunk, reassembling
 * a byte-identical file. Returns whether the local size matches the companion's
 * reported total.
 */
async function downloadBackup(
  bridge: CompanionBridge,
  id: string,
  destPath: string,
  chunkBytes: number,
): Promise<Record<string, unknown>> {
  await writeFile(destPath, new Uint8Array()); // truncate/create fresh
  let offset = 0;
  let total = 0;
  for (;;) {
    const r = await bridge.backupDownloadChunk({
      id,
      offset,
      length: chunkBytes,
    });
    const bytes = Buffer.from(String(r["data"] ?? ""), "base64");
    if (bytes.length > 0) await appendFile(destPath, bytes);
    total = Number(r["total_bytes"] ?? total);
    offset += bytes.length;
    if (r["eof"] === true || bytes.length === 0) break;
  }
  const written = (await stat(destPath)).size;
  return {
    ok: written === total,
    action: "download",
    id,
    dest_path: destPath,
    bytes: written,
    total_bytes: total,
    complete: written === total,
  };
}

/**
 * Push a local archive into WordPress, chunk by chunk. Each chunk appends at
 * its exact offset (the companion rejects a gap), and the final chunk triggers
 * validation + registration. Returns the companion's final response.
 */
async function importBackup(
  bridge: CompanionBridge,
  srcPath: string,
  chunkBytes: number,
): Promise<Record<string, unknown>> {
  const buf = await readFile(srcPath);
  if (buf.length === 0) {
    throw new WplabError(
      "BACKUP_IMPORT_EMPTY_FILE",
      `src_path is empty: ${srcPath}`,
      { src_path: srcPath },
    );
  }
  const uploadId = randomUUID();
  const filename = basename(srcPath);
  let offset = 0;
  let last: Record<string, unknown> = {};
  while (offset < buf.length) {
    const slice = buf.subarray(offset, offset + chunkBytes);
    const isFinal = offset + slice.length >= buf.length;
    last = await bridge.backupImportChunk({
      upload_id: uploadId,
      offset,
      chunk: slice.toString("base64"),
      final: isFinal,
      ...(isFinal ? { filename } : {}),
    });
    offset += slice.length;
  }
  return { action: "import", src_path: srcPath, ...last };
}

export const wpSiteBackupToolDef = {
  name: "rolepod_wp_site_backup",
  description:
    "Throttled, server-side site backup in WordPress (via the rolepod-wp companion). Produces a browsable ZIP per backup (manifest.json + database.sql + files/ mirroring wp-content). The work runs in WP on a cron loop in small chunks — it never spikes CPU — so `start` returns immediately and you poll with action=status. Actions: start (components{db,uploads,themes,plugins,muplugins}, compress, exclude[]) · status (current job + progress) · list (finished backups) · inspect (id [, entry] — read the zip's central directory or a single member like manifest.json/database.sql WITHOUT extracting) · cancel · delete (id) · download (id, dest_path — pull a backup offsite to a local file, byte-identical) · import (src_path — push a local .zip backup into WordPress, validated + registered). download/import chunk over REST and need companion v2.23+. Requires companion v2.17+ on a rest target. Restore via rolepod_wp_site_restore.",
  inputSchema: WpSiteBackupInputSchema,
};

function requireCompanion(t: Target): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "BACKUP_REQUIRES_COMPANION",
      `site backup requires a rest target with the rolepod-wp companion — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { target_kind: t.kind },
    );
  }
}

export async function wpSiteBackupHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpSiteBackupOutput> {
  const input: WpSiteBackupInput = WpSiteBackupInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  requireCompanion(target);
  const bridge = await bridgeFor(target);

  let body: Record<string, unknown>;
  switch (input.action) {
    case "start":
      body = await bridge.backupStart({
        components: input.components ?? {},
        compress: input.compress ?? true,
        exclude: input.exclude ?? [],
      });
      break;
    case "status":
      body = await bridge.backupStatus();
      break;
    case "list":
      body = await bridge.backupList();
      break;
    case "inspect":
      if (!input.id) {
        throw new WplabError(
          "BACKUP_INSPECT_ID_REQUIRED",
          "action=inspect requires `id`",
          {},
        );
      }
      body = await bridge.backupInspect({
        id: input.id,
        ...(input.entry ? { entry: input.entry } : {}),
        ...(input.max_bytes ? { max_bytes: input.max_bytes } : {}),
      });
      break;
    case "cancel":
      body = await bridge.backupCancel();
      break;
    case "delete":
      if (!input.id) {
        throw new WplabError(
          "BACKUP_DELETE_ID_REQUIRED",
          "action=delete requires `id`",
          {},
        );
      }
      body = await bridge.backupDelete(input.id);
      break;
    case "download":
      if (!input.id) {
        throw new WplabError(
          "BACKUP_DOWNLOAD_ID_REQUIRED",
          "action=download requires `id` (which backup) — see action=list",
          {},
        );
      }
      if (!input.dest_path) {
        throw new WplabError(
          "BACKUP_DOWNLOAD_DEST_REQUIRED",
          "action=download requires `dest_path` (local file to write the archive to)",
          {},
        );
      }
      body = await downloadBackup(
        bridge,
        input.id,
        input.dest_path,
        input.chunk_bytes ?? DEFAULT_CHUNK,
      );
      break;
    case "import":
      if (!input.src_path) {
        throw new WplabError(
          "BACKUP_IMPORT_SRC_REQUIRED",
          "action=import requires `src_path` (local archive to push into WordPress)",
          {},
        );
      }
      body = await importBackup(
        bridge,
        input.src_path,
        input.chunk_bytes ?? DEFAULT_CHUNK,
      );
      break;
    default:
      body = await bridge.backupStatus();
  }
  return WpSiteBackupOutputSchema.parse(body);
}
