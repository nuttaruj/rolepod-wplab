import {
  readFile,
  writeFile,
  appendFile,
  mkdir,
  chmod,
  stat,
  readdir,
  access,
  rm,
} from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import { z } from 'zod'

const META_SCHEMA_VERSION = 1

export type MemoryKind = 'note' | 'convention' | 'runbook'

export interface MemoryNote {
  kind: MemoryKind
  name: string // file basename
  content: string
  written_at: string
}

export interface MemoryFileMeta {
  kind: 'meta' | 'site' | MemoryKind
  name: string
  size_bytes: number
  mtime: string
}

export interface MemoryRecallResult {
  site_slug: string
  summary: string
  notes: MemoryNote[]
}

const MetaJsonSchema = z.object({
  schema_version: z.literal(META_SCHEMA_VERSION),
  site_slug: z.string(),
  siteurl: z.string().optional(),
  created_at: z.string(),
})

export type MetaJson = z.infer<typeof MetaJsonSchema>

/**
 * Per-site memory store (W-028). File-based, local-only, never phones home.
 *
 * Layout:
 *   <root>/<site-slug>/
 *     meta.json            schema metadata
 *     site.md              auto-rewritten on each Target.open
 *     notes.md             append-only, prefixed by ISO timestamp
 *     conventions.md       replace-with-version-marker on write
 *     runbooks/*.md        runbook name controlled by caller
 *
 * Mode 0700 dir, 0600 files. Never committed.
 */
export class MemoryStore {
  static rootDir(): string {
    const override = process.env['ROLEPOD_WPLAB_MEMORY_DIR']
    if (override) return override
    return join(homedir(), '.config', 'rolepod-wplab', 'memory')
  }

  static siteDir(siteSlug: string): string {
    return join(MemoryStore.rootDir(), siteSlug)
  }

  static async ensureSite(siteSlug: string, siteurl?: string): Promise<void> {
    const dir = MemoryStore.siteDir(siteSlug)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await mkdir(join(dir, 'runbooks'), { recursive: true, mode: 0o700 })
    const metaPath = join(dir, 'meta.json')
    if (!(await fileExists(metaPath))) {
      const meta: MetaJson = {
        schema_version: META_SCHEMA_VERSION,
        site_slug: siteSlug,
        ...(siteurl !== undefined ? { siteurl } : {}),
        created_at: new Date().toISOString(),
      }
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8')
      await chmod(metaPath, 0o600)
    }
  }

  static async exists(siteSlug: string): Promise<boolean> {
    return fileExists(join(MemoryStore.siteDir(siteSlug), 'meta.json'))
  }

  static async writeSiteSnapshot(siteSlug: string, snapshot: string): Promise<void> {
    await MemoryStore.ensureSite(siteSlug)
    const path = join(MemoryStore.siteDir(siteSlug), 'site.md')
    await writeFile(path, snapshot, 'utf8')
    await chmod(path, 0o600)
  }

  static async appendNote(
    siteSlug: string,
    content: string,
    kind: MemoryKind,
    runbookName?: string,
  ): Promise<{ filePath: string }> {
    await MemoryStore.ensureSite(siteSlug)
    const dir = MemoryStore.siteDir(siteSlug)
    const ts = new Date().toISOString()

    if (kind === 'note') {
      const path = join(dir, 'notes.md')
      const line = `[${ts}] ${content.trim()}\n`
      await appendFile(path, line, 'utf8')
      await chmod(path, 0o600)
      return { filePath: path }
    }

    if (kind === 'convention') {
      const path = join(dir, 'conventions.md')
      const block = `\n=== updated ${ts} ===\n${content.trim()}\n`
      // conventions = replace-with-history; we APPEND a versioned block so
      // history is preserved in-file without losing the new convention text.
      await appendFile(path, block, 'utf8')
      await chmod(path, 0o600)
      return { filePath: path }
    }

    // runbook
    const name = (runbookName ?? '').trim()
    if (!name) {
      throw new Error('runbook kind requires a non-empty runbook_name')
    }
    const safeName = name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
    const path = join(dir, 'runbooks', `${safeName}.md`)
    await writeFile(path, content, 'utf8')
    await chmod(path, 0o600)
    return { filePath: path }
  }

  static async list(siteSlug: string): Promise<MemoryFileMeta[]> {
    if (!(await MemoryStore.exists(siteSlug))) return []
    const dir = MemoryStore.siteDir(siteSlug)
    const out: MemoryFileMeta[] = []

    for (const f of ['meta.json', 'site.md', 'notes.md', 'conventions.md']) {
      const p = join(dir, f)
      const s = await statSafe(p)
      if (!s) continue
      const kind = f === 'meta.json' ? 'meta' : f === 'site.md' ? 'site' : f === 'notes.md' ? 'note' : 'convention'
      out.push({
        kind,
        name: f,
        size_bytes: s.size,
        mtime: new Date(s.mtimeMs).toISOString(),
      })
    }

    const runbooksDir = join(dir, 'runbooks')
    try {
      const entries = await readdir(runbooksDir)
      for (const e of entries) {
        if (!e.endsWith('.md')) continue
        const p = join(runbooksDir, e)
        const s = await statSafe(p)
        if (!s) continue
        out.push({
          kind: 'runbook',
          name: `runbooks/${e}`,
          size_bytes: s.size,
          mtime: new Date(s.mtimeMs).toISOString(),
        })
      }
    } catch {
      // no runbooks dir
    }

    return out
  }

  static async recall(
    siteSlug: string,
    opts: { query?: string; kind?: MemoryKind | 'all' } = {},
  ): Promise<MemoryRecallResult> {
    const kindFilter = opts.kind ?? 'all'
    const dir = MemoryStore.siteDir(siteSlug)
    const notes: MemoryNote[] = []

    if (!(await MemoryStore.exists(siteSlug))) {
      return { site_slug: siteSlug, summary: '', notes: [] }
    }

    if (kindFilter === 'all' || kindFilter === 'note') {
      const content = await readSafe(join(dir, 'notes.md'))
      if (content) {
        const s = await statSafe(join(dir, 'notes.md'))
        notes.push({
          kind: 'note',
          name: 'notes.md',
          content,
          written_at: s ? new Date(s.mtimeMs).toISOString() : '',
        })
      }
    }

    if (kindFilter === 'all' || kindFilter === 'convention') {
      const content = await readSafe(join(dir, 'conventions.md'))
      if (content) {
        const s = await statSafe(join(dir, 'conventions.md'))
        notes.push({
          kind: 'convention',
          name: 'conventions.md',
          content,
          written_at: s ? new Date(s.mtimeMs).toISOString() : '',
        })
      }
    }

    if (kindFilter === 'all' || kindFilter === 'runbook') {
      const runbooksDir = join(dir, 'runbooks')
      try {
        const entries = await readdir(runbooksDir)
        for (const e of entries) {
          if (!e.endsWith('.md')) continue
          const content = await readSafe(join(runbooksDir, e))
          if (!content) continue
          const s = await statSafe(join(runbooksDir, e))
          notes.push({
            kind: 'runbook',
            name: `runbooks/${e}`,
            content,
            written_at: s ? new Date(s.mtimeMs).toISOString() : '',
          })
        }
      } catch {
        // ignore
      }
    }

    // Filter by query (substring, case-insensitive) on note bodies.
    const filtered = opts.query
      ? notes.filter((n) => n.content.toLowerCase().includes(opts.query!.toLowerCase()))
      : notes

    const summary = summarize(filtered)
    return { site_slug: siteSlug, summary, notes: filtered }
  }

  static async clear(siteSlug: string): Promise<boolean> {
    const dir = MemoryStore.siteDir(siteSlug)
    if (!(await fileExists(dir))) return false
    await rm(dir, { recursive: true, force: true })
    return true
  }

  static async listAllSites(): Promise<string[]> {
    const root = MemoryStore.rootDir()
    try {
      const entries = await readdir(root, { withFileTypes: true })
      return entries.filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
  }

  static async export(siteSlug: string): Promise<string> {
    if (!(await MemoryStore.exists(siteSlug))) return ''
    const dir = MemoryStore.siteDir(siteSlug)
    const parts: string[] = []
    parts.push(`# Memory export: ${siteSlug}`)
    parts.push(`Generated: ${new Date().toISOString()}\n`)

    for (const f of ['site.md', 'notes.md', 'conventions.md']) {
      const c = await readSafe(join(dir, f))
      if (c) {
        parts.push(`\n## ${f}\n\n${c}`)
      }
    }
    try {
      const entries = await readdir(join(dir, 'runbooks'))
      for (const e of entries) {
        if (!e.endsWith('.md')) continue
        const c = await readSafe(join(dir, 'runbooks', e))
        if (c) {
          parts.push(`\n## runbooks/${e}\n\n${c}`)
        }
      }
    } catch {
      // ignore
    }
    return parts.join('\n')
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function statSafe(p: string) {
  try {
    return await stat(p)
  } catch {
    return null
  }
}

async function readSafe(p: string): Promise<string | null> {
  try {
    return await readFile(p, 'utf8')
  } catch {
    return null
  }
}

function summarize(notes: MemoryNote[]): string {
  if (notes.length === 0) return ''
  const parts: string[] = []
  for (const n of notes) {
    const head = n.content.trim().split('\n').slice(0, 5).join('\n')
    parts.push(`### ${n.kind}: ${basename(n.name)}\n${head}`)
  }
  return parts.slice(0, 6).join('\n\n')
}
