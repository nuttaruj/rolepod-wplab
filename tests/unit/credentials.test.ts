import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileVault } from '../../src/credentials/FileVault.js'
import { canonicalizeSite } from '../../src/credentials/types.js'

describe('canonicalizeSite', () => {
  it('lowercases hostname', () => {
    expect(canonicalizeSite('https://Walnutztudio.com/')).toBe('walnutztudio.com')
  })

  it('strips path + port', () => {
    expect(canonicalizeSite('https://site.com:443/path')).toBe('site.com')
  })

  it('accepts bare hostname (assumes https)', () => {
    expect(canonicalizeSite('walnutztudio.com')).toBe('walnutztudio.com')
  })

  it('handles subdomains', () => {
    expect(canonicalizeSite('https://Staging.Site.Co.UK/admin')).toBe('staging.site.co.uk')
  })

  it('rejects empty input', () => {
    expect(() => canonicalizeSite('')).toThrow(/empty/i)
    expect(() => canonicalizeSite('   ')).toThrow(/empty/i)
  })

  it('rejects garbage', () => {
    expect(() => canonicalizeSite(':::::')).toThrow(/invalid/i)
  })
})

describe('FileVault', () => {
  let tmp: string
  let path: string
  let vault: FileVault

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wplab-creds-'))
    path = join(tmp, 'credentials.json')
    vault = new FileVault(path)
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns null for missing site', async () => {
    expect(await vault.get('absent.com')).toBeNull()
  })

  it('returns empty list when no file exists', async () => {
    expect(await vault.list()).toEqual([])
  })

  it('add + get round-trips the credential', async () => {
    await vault.add({
      site: 'walnutztudio.com',
      username: 'admin',
      appPassword: 'xxxx-yyyy-zzzz',
      addedAt: '2026-05-25T12:00:00Z',
    })
    const got = await vault.get('walnutztudio.com')
    expect(got).not.toBeNull()
    expect(got!.username).toBe('admin')
    expect(got!.appPassword).toBe('xxxx-yyyy-zzzz')
  })

  it('add upserts (replaces existing site)', async () => {
    await vault.add({
      site: 'site.com',
      username: 'a',
      appPassword: 'pw1',
      addedAt: '2026-05-25T12:00:00Z',
    })
    await vault.add({
      site: 'site.com',
      username: 'b',
      appPassword: 'pw2',
      addedAt: '2026-05-25T13:00:00Z',
    })
    const list = await vault.list()
    expect(list).toHaveLength(1)
    const got = await vault.get('site.com')
    expect(got!.username).toBe('b')
    expect(got!.appPassword).toBe('pw2')
  })

  it('list returns metadata without secret', async () => {
    await vault.add({
      site: 'a.com',
      username: 'u1',
      appPassword: 'secret',
      addedAt: '2026-05-25T12:00:00Z',
    })
    const list = await vault.list()
    expect(list[0]!.site).toBe('a.com')
    expect(list[0]!.username).toBe('u1')
    expect(list[0]!.source).toBe('file')
    expect((list[0] as unknown as { appPassword?: string }).appPassword).toBeUndefined()
  })

  it('remove returns true on hit, false on miss', async () => {
    await vault.add({
      site: 'x.com',
      username: 'u',
      appPassword: 'p',
      addedAt: '2026-05-25T12:00:00Z',
    })
    expect(await vault.remove('x.com')).toBe(true)
    expect(await vault.remove('x.com')).toBe(false)
    expect(await vault.get('x.com')).toBeNull()
  })

  it('touch updates lastUsedAt', async () => {
    await vault.add({
      site: 'touch.com',
      username: 'u',
      appPassword: 'p',
      addedAt: '2026-05-25T12:00:00Z',
    })
    await vault.touch('touch.com')
    const got = await vault.get('touch.com')
    expect(got!.lastUsedAt).toBeDefined()
    expect(new Date(got!.lastUsedAt!).getTime()).toBeGreaterThan(0)
  })

  it('touch on missing site is a no-op (no throw)', async () => {
    await expect(vault.touch('absent.com')).resolves.toBeUndefined()
  })

  it('writes credentials file at mode 0600', async () => {
    await vault.add({
      site: 'perms.com',
      username: 'u',
      appPassword: 'p',
      addedAt: '2026-05-25T12:00:00Z',
    })
    expect(existsSync(path)).toBe(true)
    const mode = statSync(path).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('rejects corrupted file', async () => {
    const corrupt = new FileVault(join(tmp, 'corrupt.json'))
    const { writeFileSync, mkdirSync } = await import('node:fs')
    mkdirSync(tmp, { recursive: true })
    writeFileSync(join(tmp, 'corrupt.json'), '{ not valid json')
    await expect(corrupt.list()).rejects.toThrow(/corrupted/)
  })
})
