import { describe, expect, it, vi, afterEach } from 'vitest'
import { TargetRegistry } from '../../src/target/TargetRegistry.js'
import { TargetNotFoundError } from '../../src/util/errors.js'
import type { Target } from '../../src/runtime/Target.js'

function fakeTarget(id: string): Target {
  return {
    id,
    kind: 'local',
    siteurl: 'http://localhost',
    wpVersion: '6.6.2',
    companion: null,
    wpCli: async () => ({ exitCode: 0, stdout: '', stderr: '', durationMs: 0 }),
    rest: async () => ({ status: 200, body: null, headers: {} }),
    fileRead: async () => ({ content: '', bytes: 0, absolutePath: '/x' }),
    fileWrite: async () => ({ bytesWritten: 0, backupPath: null, absolutePath: '/x' }),
    fileExists: async () => false,
    rootPath: () => '/x',
    close: vi.fn(async () => undefined),
  }
}

describe('TargetRegistry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('register + get round-trips the target', () => {
    const reg = new TargetRegistry(60_000)
    const t = fakeTarget('tgt_aaaaaaaa')
    reg.register(t)
    expect(reg.get('tgt_aaaaaaaa')).toBe(t)
    expect(reg.list()).toHaveLength(1)
  })

  it('get throws TargetNotFoundError for unknown id', () => {
    const reg = new TargetRegistry(60_000)
    expect(() => reg.get('tgt_missing0')).toThrow(TargetNotFoundError)
  })

  it('rejects double-register of same id', () => {
    const reg = new TargetRegistry(60_000)
    const t = fakeTarget('tgt_dupedupe')
    reg.register(t)
    expect(() => reg.register(t)).toThrow(/collision/)
  })

  it('disconnect removes target + invokes close()', async () => {
    const reg = new TargetRegistry(60_000)
    const t = fakeTarget('tgt_closeit0')
    reg.register(t)
    await reg.disconnect('tgt_closeit0')
    expect(reg.list()).toHaveLength(0)
    expect(t.close).toHaveBeenCalledOnce()
    expect(() => reg.get('tgt_closeit0')).toThrow(TargetNotFoundError)
  })

  it('disconnect throws when target unknown', async () => {
    const reg = new TargetRegistry(60_000)
    await expect(reg.disconnect('tgt_ghostghost')).rejects.toThrow(TargetNotFoundError)
  })

  it('closeAll closes every registered target', async () => {
    const reg = new TargetRegistry(60_000)
    const a = fakeTarget('tgt_aaaaaaaa')
    const b = fakeTarget('tgt_bbbbbbbb')
    reg.register(a)
    reg.register(b)
    await reg.closeAll()
    expect(reg.list()).toHaveLength(0)
    expect(a.close).toHaveBeenCalledOnce()
    expect(b.close).toHaveBeenCalledOnce()
  })

  it('idle timer fires close() after configured idle window', async () => {
    vi.useFakeTimers()
    const reg = new TargetRegistry(10_000)
    const t = fakeTarget('tgt_idleidle')
    reg.register(t)
    expect(reg.list()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(10_001)
    expect(reg.list()).toHaveLength(0)
    expect(t.close).toHaveBeenCalledOnce()
  })

  it('get() resets the idle timer (target stays alive)', async () => {
    vi.useFakeTimers()
    const reg = new TargetRegistry(10_000)
    const t = fakeTarget('tgt_keepalive')
    reg.register(t)
    await vi.advanceTimersByTimeAsync(8_000)
    reg.get('tgt_keepalive') // bump
    await vi.advanceTimersByTimeAsync(8_000)
    expect(reg.list()).toHaveLength(1)
    expect(t.close).not.toHaveBeenCalled()
  })
})
