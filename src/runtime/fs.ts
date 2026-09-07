import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  stat,
  access,
  readdir,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, basename, join } from "node:path";
import { resolveScopedWrite } from "../safety/FsScope.js";
import { FsScopeError } from "../util/errors.js";
import type { FileWriteOpts } from "./Target.js";

const READ_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MiB; v0.0 — revisit if real work needs bigger

/** Per-file backup suffix written next to the target before an overwrite. */
export const BACKUP_SUFFIX = ".wplab-bak-";

/** How many `<file>.wplab-bak-*` copies survive a write. */
export const BACKUP_KEEP_DEFAULT = 2;

/**
 * What may sit after the suffix. Timestamps and uuid batch ids match; a
 * backup-of-a-backup ("foo.php.wplab-bak-X.wplab-bak-Y") does not, so pruning
 * one file's copies never reaches into another file's.
 */
const BACKUP_STAMP = /^[A-Za-z0-9_-]+$/;

/**
 * Backups accumulate one file per write, forever, inside the user's WP
 * install — so every write prunes its own siblings down to the newest N.
 * Reverting an AI change does not read these: the Change Ledger stores its
 * own content snapshot, so pruning costs only the on-disk copies a human
 * would dig out by hand.
 */
export function backupKeepCount(): number {
  const raw = process.env["ROLEPOD_WPLAB_BACKUP_KEEP"];
  if (raw === undefined || raw.trim() === "") return BACKUP_KEEP_DEFAULT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return BACKUP_KEEP_DEFAULT;
  return n;
}

export async function readScopedFile(
  wpRoot: string,
  relPath: string,
): Promise<{ content: string; bytes: number; absolutePath: string }> {
  // Reads have a wider scope than writes (read-only is safer) but still confined to wpRoot.
  const abs = await safeResolveRead(wpRoot, relPath);
  const stats = await stat(abs);
  if (stats.size > READ_LIMIT_BYTES) {
    throw new FsScopeError(
      relPath,
      `file too large (${stats.size} bytes, max ${READ_LIMIT_BYTES})`,
    );
  }
  const content = await readFile(abs, "utf8");
  return { content, bytes: stats.size, absolutePath: abs };
}

export async function writeScopedFile(
  wpRoot: string,
  relPath: string,
  content: string,
  opts: FileWriteOpts,
): Promise<{
  bytesWritten: number;
  backupPath: string | null;
  absolutePath: string;
}> {
  const abs = resolveScopedWrite(
    wpRoot,
    relPath,
    opts.confirmUnsafePath ?? false,
  );
  await mkdir(dirname(abs), { recursive: true });

  let backupPath: string | null = null;
  if ((opts.backup ?? true) && (await fileExists(abs))) {
    backupPath = await makeBackup(abs);
    await pruneBackups(abs);
  }

  if (opts.mode === "append") {
    const prior = (await fileExists(abs)) ? await readFile(abs, "utf8") : "";
    await writeFile(abs, prior + content, "utf8");
  } else {
    await writeFile(abs, content, "utf8");
  }

  const stats = await stat(abs);
  return { bytesWritten: stats.size, backupPath, absolutePath: abs };
}

export async function fileExists(abs: string): Promise<boolean> {
  try {
    await access(abs, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function safeResolveRead(
  wpRoot: string,
  relPath: string,
): Promise<string> {
  // For reads, accept anything under wpRoot. Writes are stricter.
  const abs = join(wpRoot, relPath);
  if (!abs.startsWith(wpRoot)) {
    throw new FsScopeError(relPath, "read path escapes WP install root");
  }
  return abs;
}

async function makeBackup(abs: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const base = join(dirname(abs), `${basename(abs)}${BACKUP_SUFFIX}${ts}`);
  // Two writes inside the same millisecond would otherwise share a filename
  // and the second would overwrite the first — losing a state retention was
  // meant to hold. The counter also keeps name order chronological.
  let backup = base;
  for (let n = 1; await fileExists(backup); n++) {
    backup = `${base}-${n}`;
  }
  await copyFile(abs, backup);
  return backup;
}

/**
 * Delete all but the newest `keep` backups of one file. Ordered by mtime
 * (newest first), name as the tie-break — two writes inside the same second
 * would otherwise be unordered. Returns the paths actually removed.
 */
export async function pruneBackups(
  abs: string,
  keep: number = backupKeepCount(),
): Promise<string[]> {
  const dir = dirname(abs);
  const prefix = `${basename(abs)}${BACKUP_SUFFIX}`;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const found: { path: string; mtime: number; name: string }[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    if (!BACKUP_STAMP.test(name.slice(prefix.length))) continue;
    const path = join(dir, name);
    try {
      const st = await stat(path);
      if (!st.isFile()) continue;
      found.push({ path, mtime: st.mtimeMs, name });
    } catch {
      // Vanished mid-scan (a concurrent write pruned it) — nothing to do.
    }
  }
  if (found.length <= keep) return [];

  found.sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  const removed: string[] = [];
  for (const old of found.slice(keep)) {
    try {
      await unlink(old.path);
      removed.push(old.path);
    } catch {
      // Read-only dir or a racing prune — leaving the file is the safe miss.
    }
  }
  return removed;
}
