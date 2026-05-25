import { execa } from 'execa'
import { readFile, writeFile, mkdir, chmod, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { Credential, CredentialMeta, Vault } from './types.js'

const SERVICE_NAME = 'rolepod-wplab'

const MetaEntrySchema = z.object({
  site: z.string(),
  username: z.string(),
  addedAt: z.string(),
  lastUsedAt: z.string().optional(),
})

const MetaStoreSchema = z.object({
  version: z.literal(1),
  entries: z.array(MetaEntrySchema),
})

type MetaStore = z.infer<typeof MetaStoreSchema>

/**
 * Credential vault backed by macOS Keychain.
 *
 * Secret (Application Password) lives in keychain via `security`. Metadata
 * (site list, username, timestamps) lives in a sidecar JSON at mode 0600 so
 * we can list entries without scraping `security dump-keychain`.
 *
 * Sidecar path is provided by factory so tests can isolate.
 */
export class KeychainVault implements Vault {
  private readonly metaPath: string

  constructor(metaPath: string) {
    this.metaPath = metaPath
  }

  async add(c: Credential): Promise<void> {
    // -U = update if exists
    await execa('security', [
      'add-generic-password',
      '-s',
      SERVICE_NAME,
      '-a',
      c.site,
      '-w',
      c.appPassword,
      '-U',
    ])

    const meta = await this.readMeta()
    const filtered = meta.entries.filter((e) => e.site !== c.site)
    const entry = {
      site: c.site,
      username: c.username,
      addedAt: c.addedAt,
      ...(c.lastUsedAt !== undefined ? { lastUsedAt: c.lastUsedAt } : {}),
    }
    filtered.push(entry)
    await this.writeMeta({ version: 1, entries: filtered })
  }

  async get(site: string): Promise<Credential | null> {
    const meta = await this.readMeta()
    const m = meta.entries.find((e) => e.site === site)
    if (!m) return null

    const result = await execa(
      'security',
      ['find-generic-password', '-s', SERVICE_NAME, '-a', site, '-w'],
      { reject: false },
    )
    if (result.exitCode !== 0) {
      // Metadata has entry but keychain doesn't — drift. Treat as missing.
      return null
    }
    return {
      site: m.site,
      username: m.username,
      appPassword: result.stdout.trim(),
      addedAt: m.addedAt,
      ...(m.lastUsedAt !== undefined ? { lastUsedAt: m.lastUsedAt } : {}),
    }
  }

  async list(): Promise<CredentialMeta[]> {
    const meta = await this.readMeta()
    return meta.entries.map((e) => {
      const out: CredentialMeta = {
        site: e.site,
        username: e.username,
        addedAt: e.addedAt,
        source: 'keychain',
      }
      if (e.lastUsedAt !== undefined) out.lastUsedAt = e.lastUsedAt
      return out
    })
  }

  async remove(site: string): Promise<boolean> {
    const meta = await this.readMeta()
    const before = meta.entries.length
    const filtered = meta.entries.filter((e) => e.site !== site)
    if (filtered.length === before) return false

    // Best-effort keychain delete (may fail if entry already missing)
    await execa(
      'security',
      ['delete-generic-password', '-s', SERVICE_NAME, '-a', site],
      { reject: false },
    )
    await this.writeMeta({ version: 1, entries: filtered })
    return true
  }

  async touch(site: string): Promise<void> {
    const meta = await this.readMeta()
    const idx = meta.entries.findIndex((e) => e.site === site)
    if (idx < 0) return
    meta.entries[idx]!.lastUsedAt = new Date().toISOString()
    await this.writeMeta(meta)
  }

  private async readMeta(): Promise<MetaStore> {
    try {
      await access(this.metaPath, constants.R_OK)
    } catch {
      return { version: 1, entries: [] }
    }
    const raw = await readFile(this.metaPath, 'utf8')
    try {
      return MetaStoreSchema.parse(JSON.parse(raw))
    } catch {
      throw new Error(`credentials metadata is corrupted: ${this.metaPath}`)
    }
  }

  private async writeMeta(store: MetaStore): Promise<void> {
    await mkdir(dirname(this.metaPath), { recursive: true })
    await writeFile(this.metaPath, JSON.stringify(store, null, 2), 'utf8')
    await chmod(this.metaPath, 0o600)
  }
}

/**
 * Quick probe: does this machine have the `security` binary?
 */
export async function keychainAvailable(): Promise<boolean> {
  try {
    const result = await execa('security', ['list-keychains'], { reject: false, timeout: 2000 })
    return result.exitCode === 0
  } catch {
    return false
  }
}
