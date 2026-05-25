import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../../src/memory/MemoryStore.js'

const SAVED_ENV = { ...process.env }

describe('MemoryStore', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'wplab-mem-'))
    process.env['ROLEPOD_WPLAB_MEMORY_DIR'] = tmp
  })

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    process.env = { ...SAVED_ENV }
  })

  it('exists is false for empty store', async () => {
    expect(await MemoryStore.exists('walnutztudio.com')).toBe(false)
  })

  it('ensureSite creates dir + meta.json at mode 0700/0600', async () => {
    await MemoryStore.ensureSite('walnutztudio.com', 'https://walnutztudio.com')
    expect(await MemoryStore.exists('walnutztudio.com')).toBe(true)
    const meta = JSON.parse(readFileSync(join(tmp, 'walnutztudio.com', 'meta.json'), 'utf8'))
    expect(meta.site_slug).toBe('walnutztudio.com')
    expect(meta.siteurl).toBe('https://walnutztudio.com')
    expect(meta.schema_version).toBe(1)
  })

  it('appendNote (note) is append-only with ISO timestamp prefix', async () => {
    await MemoryStore.appendNote('site.com', 'first note', 'note')
    await MemoryStore.appendNote('site.com', 'second note', 'note')
    const content = readFileSync(join(tmp, 'site.com', 'notes.md'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] first note$/)
    expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] second note$/)
  })

  it('appendNote (convention) appends with version marker', async () => {
    await MemoryStore.appendNote('site.com', 'use ACF Pro field group X', 'convention')
    await MemoryStore.appendNote('site.com', 'switched to Meta Box', 'convention')
    const content = readFileSync(join(tmp, 'site.com', 'conventions.md'), 'utf8')
    expect(content).toContain('=== updated ')
    expect(content).toContain('use ACF Pro field group X')
    expect(content).toContain('switched to Meta Box')
  })

  it('appendNote (runbook) requires runbook_name', async () => {
    await expect(MemoryStore.appendNote('site.com', 'deploy steps', 'runbook')).rejects.toThrow(/runbook_name/)
  })

  it('appendNote (runbook) writes to runbooks/<name>.md replacing previous', async () => {
    await MemoryStore.appendNote('site.com', 'first version', 'runbook', 'deploy')
    await MemoryStore.appendNote('site.com', 'second version', 'runbook', 'deploy')
    const content = readFileSync(join(tmp, 'site.com', 'runbooks', 'deploy.md'), 'utf8')
    expect(content).toBe('second version')
  })

  it('list returns metadata of all files', async () => {
    await MemoryStore.ensureSite('site.com')
    await MemoryStore.appendNote('site.com', 'a note', 'note')
    await MemoryStore.appendNote('site.com', 'a runbook', 'runbook', 'deploy')
    const files = await MemoryStore.list('site.com')
    const kinds = files.map((f) => f.kind).sort()
    expect(kinds).toContain('meta')
    expect(kinds).toContain('note')
    expect(kinds).toContain('runbook')
  })

  it('recall returns notes + summary', async () => {
    await MemoryStore.appendNote('site.com', 'Slider Revolution disabled', 'note')
    await MemoryStore.appendNote('site.com', 'use ACF Pro', 'convention')
    const res = await MemoryStore.recall('site.com')
    expect(res.site_slug).toBe('site.com')
    expect(res.notes).toHaveLength(2)
    expect(res.summary).toContain('Slider Revolution')
  })

  it('recall filters by query substring (case-insensitive)', async () => {
    await MemoryStore.appendNote('site.com', 'Bricks v1.8.5 upgraded', 'note')
    await MemoryStore.appendNote('site.com', 'Elementor settings tweaked', 'note')
    const res = await MemoryStore.recall('site.com', { query: 'bricks' })
    expect(res.notes).toHaveLength(1)
    expect(res.notes[0]!.content).toContain('Bricks')
  })

  it('recall filters by kind', async () => {
    await MemoryStore.appendNote('site.com', 'note text', 'note')
    await MemoryStore.appendNote('site.com', 'convention text', 'convention')
    const onlyConv = await MemoryStore.recall('site.com', { kind: 'convention' })
    expect(onlyConv.notes).toHaveLength(1)
    expect(onlyConv.notes[0]!.kind).toBe('convention')
  })

  it('recall on missing site returns empty result (no throw)', async () => {
    const res = await MemoryStore.recall('absent.com')
    expect(res.notes).toEqual([])
    expect(res.summary).toBe('')
  })

  it('clear removes site dir and returns true', async () => {
    await MemoryStore.ensureSite('site.com')
    expect(await MemoryStore.clear('site.com')).toBe(true)
    expect(await MemoryStore.exists('site.com')).toBe(false)
    expect(await MemoryStore.clear('site.com')).toBe(false)
  })

  it('listAllSites returns all stored site slugs', async () => {
    await MemoryStore.ensureSite('one.com')
    await MemoryStore.ensureSite('two.com')
    const sites = await MemoryStore.listAllSites()
    expect(sites.sort()).toEqual(['one.com', 'two.com'])
  })

  it('export bundles all files into a single markdown document', async () => {
    await MemoryStore.appendNote('site.com', 'note one', 'note')
    await MemoryStore.appendNote('site.com', 'conv one', 'convention')
    await MemoryStore.appendNote('site.com', 'rb content', 'runbook', 'deploy')
    const out = await MemoryStore.export('site.com')
    expect(out).toContain('# Memory export: site.com')
    expect(out).toContain('note one')
    expect(out).toContain('conv one')
    expect(out).toContain('rb content')
  })

  it('export on missing site returns empty string', async () => {
    const out = await MemoryStore.export('absent.com')
    expect(out).toBe('')
  })

  it('site dir mode is 0700', async () => {
    await MemoryStore.ensureSite('site.com')
    const mode = statSync(join(tmp, 'site.com')).mode & 0o777
    expect(mode).toBe(0o700)
  })

  it('writeSiteSnapshot replaces site.md', async () => {
    await MemoryStore.writeSiteSnapshot('site.com', 'first snapshot')
    await MemoryStore.writeSiteSnapshot('site.com', 'second snapshot')
    expect(readFileSync(join(tmp, 'site.com', 'site.md'), 'utf8')).toBe('second snapshot')
  })
})
