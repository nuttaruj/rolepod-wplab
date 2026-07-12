import { appendFile, readFile, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompanionBridge } from "./Bridge.js";
import { WplabError } from "../util/errors.js";

export const DEFAULT_CHUNK = 1_048_576;

/**
 * Pull an archive from WordPress to a local path, chunk by chunk, reassembling
 * a byte-identical file. Returns whether the local size matches the companion's
 * reported total.
 *
 * Shared by rolepod_wp_site_backup (action=download) and rolepod_wp_migrate_site
 * (source snapshot → host → dest hop).
 */
export async function downloadBackup(
  bridge: CompanionBridge,
  id: string,
  destPath: string,
  chunkBytes: number,
): Promise<{
  ok: boolean;
  action: "download";
  id: string;
  dest_path: string;
  bytes: number;
  total_bytes: number;
  complete: boolean;
}> {
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
 *
 * Shared by rolepod_wp_site_backup (action=import) and rolepod_wp_migrate_site.
 */
export async function importBackup(
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
