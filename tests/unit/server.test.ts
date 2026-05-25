import { describe, expect, it } from 'vitest'
import { createServer } from '../../src/server.js'
import { checkWpCli } from '../../src/safety/AllowList.js'
import { ProdGuard } from '../../src/safety/ProdGuard.js'
import { resolveScopedWrite } from '../../src/safety/FsScope.js'
import { ProductionBlockedError, FsScopeError } from '../../src/util/errors.js'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('createServer', () => {
  it('wires without binding stdio', async () => {
    const { server, registry, shutdown } = await createServer({ withoutTransport: true })
    expect(server).toBeDefined()
    expect(registry.list()).toHaveLength(0)
    await shutdown()
  })
})

describe('safety/AllowList', () => {
  it('allows read-only subcommands without opt-in', () => {
    expect(checkWpCli(['plugin', 'list'], false).allowed).toBe(true)
    expect(checkWpCli(['option', 'get', 'siteurl'], false).allowed).toBe(true)
    expect(checkWpCli(['core', 'version'], false).allowed).toBe(true)
  })

  it('blocks destructive subcommands without opt-in', () => {
    const verdict = checkWpCli(['plugin', 'install', 'jetpack'], false)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.kind).toBe('not_in_allowlist')
  })

  it('allows destructive subcommands when opt-in', () => {
    expect(checkWpCli(['plugin', 'install', 'jetpack'], true).allowed).toBe(true)
    expect(checkWpCli(['option', 'update', 'siteurl', 'https://x.test'], true).allowed).toBe(true)
  })

  it('never allows db reset / db drop regardless of opt-in', () => {
    const reset = checkWpCli(['db', 'reset'], true)
    expect(reset.allowed).toBe(false)
    if (!reset.allowed) expect(reset.kind).toBe('never_allowed')

    const drop = checkWpCli(['db', 'drop'], true)
    expect(drop.allowed).toBe(false)
    if (!drop.allowed) expect(drop.kind).toBe('never_allowed')
  })

  it('rejects empty args', () => {
    expect(checkWpCli([], false).allowed).toBe(false)
  })
})

describe('safety/ProdGuard', () => {
  it('matches exact host', () => {
    const guard = new ProdGuard(['mysite.com'])
    expect(guard.matches('https://mysite.com').matched).toBe(true)
    expect(guard.matches('https://staging.mysite.com').matched).toBe(false)
  })

  it('matches glob wildcard', () => {
    const guard = new ProdGuard(['*.mysite.com'])
    expect(guard.matches('https://staging.mysite.com').matched).toBe(true)
    expect(guard.matches('https://mysite.com').matched).toBe(false)
  })

  it('returns false for invalid urls', () => {
    const guard = new ProdGuard(['mysite.com'])
    expect(guard.matches('not-a-url').matched).toBe(false)
  })

  it('enforce throws ProductionBlockedError on match', () => {
    const guard = new ProdGuard(['mysite.com'])
    expect(() => guard.enforce('https://mysite.com')).toThrow(ProductionBlockedError)
  })

  it('enforce does not throw on non-match', () => {
    const guard = new ProdGuard(['mysite.com'])
    expect(() => guard.enforce('https://local.test')).not.toThrow()
  })
})

describe('safety/FsScope', () => {
  const wpRoot = mkdtempSync(join(tmpdir(), 'wplab-fs-'))

  it('allows wp-content/plugins write', () => {
    mkdirSync(join(wpRoot, 'wp-content', 'plugins', 'sample'), { recursive: true })
    writeFileSync(join(wpRoot, 'wp-content', 'plugins', 'sample', 'sample.php'), '')
    const abs = resolveScopedWrite(wpRoot, 'wp-content/plugins/sample/sample.php', false)
    expect(abs).toContain('wp-content/plugins/sample/sample.php')
  })

  it('allows wp-config.php', () => {
    writeFileSync(join(wpRoot, 'wp-config.php'), '<?php')
    expect(() => resolveScopedWrite(wpRoot, 'wp-config.php', false)).not.toThrow()
  })

  it('rejects wp-admin write without confirm', () => {
    mkdirSync(join(wpRoot, 'wp-admin'), { recursive: true })
    expect(() => resolveScopedWrite(wpRoot, 'wp-admin/evil.php', false)).toThrow(FsScopeError)
  })

  it('allows wp-admin with confirm_unsafe_path=true', () => {
    expect(() => resolveScopedWrite(wpRoot, 'wp-admin/explicit.php', true)).not.toThrow()
  })

  it('rejects path traversal outside wpRoot', () => {
    expect(() => resolveScopedWrite(wpRoot, '../escape.txt', false)).toThrow(FsScopeError)
  })

  it('rejects disallowed extension in uploads/', () => {
    expect(() => resolveScopedWrite(wpRoot, 'wp-content/uploads/payload.exe', false)).toThrow(
      FsScopeError,
    )
  })

  it('allows allowed extension in uploads/', () => {
    expect(() =>
      resolveScopedWrite(wpRoot, 'wp-content/uploads/2026/05/photo.jpg', false),
    ).not.toThrow()
  })
})
