import { readFile, writeFile, mkdir, copyFile, stat, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { resolveScopedWrite } from '../safety/FsScope.js'
import { FsScopeError } from '../util/errors.js'
import type { FileWriteOpts } from './Target.js'

const READ_LIMIT_BYTES = 5 * 1024 * 1024 // 5 MiB; v0.0 — revisit if real work needs bigger

export async function readScopedFile(
  wpRoot: string,
  relPath: string,
): Promise<{ content: string; bytes: number; absolutePath: string }> {
  // Reads have a wider scope than writes (read-only is safer) but still confined to wpRoot.
  const abs = await safeResolveRead(wpRoot, relPath)
  const stats = await stat(abs)
  if (stats.size > READ_LIMIT_BYTES) {
    throw new FsScopeError(relPath, `file too large (${stats.size} bytes, max ${READ_LIMIT_BYTES})`)
  }
  const content = await readFile(abs, 'utf8')
  return { content, bytes: stats.size, absolutePath: abs }
}

export async function writeScopedFile(
  wpRoot: string,
  relPath: string,
  content: string,
  opts: FileWriteOpts,
): Promise<{ bytesWritten: number; backupPath: string | null; absolutePath: string }> {
  const abs = resolveScopedWrite(wpRoot, relPath, opts.confirmUnsafePath ?? false)
  await mkdir(dirname(abs), { recursive: true })

  let backupPath: string | null = null
  if ((opts.backup ?? true) && (await fileExists(abs))) {
    backupPath = await makeBackup(abs)
  }

  if (opts.mode === 'append') {
    const prior = (await fileExists(abs)) ? await readFile(abs, 'utf8') : ''
    await writeFile(abs, prior + content, 'utf8')
  } else {
    await writeFile(abs, content, 'utf8')
  }

  const stats = await stat(abs)
  return { bytesWritten: stats.size, backupPath, absolutePath: abs }
}

export async function fileExists(abs: string): Promise<boolean> {
  try {
    await access(abs, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function safeResolveRead(wpRoot: string, relPath: string): Promise<string> {
  // For reads, accept anything under wpRoot. Writes are stricter.
  const abs = join(wpRoot, relPath)
  if (!abs.startsWith(wpRoot)) {
    throw new FsScopeError(relPath, 'read path escapes WP install root')
  }
  return abs
}

async function makeBackup(abs: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = join(dirname(abs), `${basename(abs)}.wplab-bak-${ts}`)
  await copyFile(abs, backup)
  return backup
}
