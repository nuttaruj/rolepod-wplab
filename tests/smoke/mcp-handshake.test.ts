import { describe, expect, it, beforeAll } from 'vitest'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Smoke: spawn the built `rolepod-wplab` MCP server and drive a JSON-RPC
 * handshake over stdio. No live WordPress is touched — just initialize +
 * tools/list. Catches regressions in the transport wiring, tool registration,
 * and schema export pipeline.
 *
 * Requires `npm run build` to have produced ./dist/bin/rolepod-wplab.js.
 */

const BIN = resolve(__dirname, '../../dist/bin/rolepod-wplab.js')

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: number | string
  result?: unknown
  error?: { code: number; message: string }
}

async function withServer<T>(
  fn: (
    proc: ChildProcessWithoutNullStreams,
    awaitResponse: (id: number, timeoutMs?: number) => Promise<JsonRpcResponse>,
  ) => Promise<T>,
): Promise<T> {
  const proc = spawn('node', [BIN, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] })

  const buffered: JsonRpcResponse[] = []
  const waiters: Array<{ id: number; resolve: (v: JsonRpcResponse) => void }> = []
  let leftover = ''

  proc.stdout.on('data', (chunk: Buffer) => {
    leftover += chunk.toString()
    let nl: number
    while ((nl = leftover.indexOf('\n')) !== -1) {
      const line = leftover.slice(0, nl).trim()
      leftover = leftover.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line) as JsonRpcResponse
        const idx = waiters.findIndex((w) => w.id === msg.id)
        if (idx >= 0) {
          waiters.splice(idx, 1)[0]!.resolve(msg)
        } else {
          buffered.push(msg)
        }
      } catch {
        // ignore non-json (shouldn't happen — stderr is the noise channel)
      }
    }
  })

  const awaitResponse = (id: number, timeoutMs = 5000): Promise<JsonRpcResponse> => {
    const hit = buffered.findIndex((m) => m.id === id)
    if (hit >= 0) return Promise.resolve(buffered.splice(hit, 1)[0]!)
    return new Promise<JsonRpcResponse>((resolveFn, rejectFn) => {
      const w = { id, resolve: resolveFn }
      waiters.push(w)
      setTimeout(() => {
        const idx = waiters.indexOf(w)
        if (idx >= 0) {
          waiters.splice(idx, 1)
          rejectFn(new Error(`timeout waiting for JSON-RPC id ${id}`))
        }
      }, timeoutMs).unref()
    })
  }

  try {
    return await fn(proc, awaitResponse)
  } finally {
    proc.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 100))
  }
}

beforeAll(() => {
  if (!existsSync(BIN)) {
    throw new Error(`Build artifact missing: ${BIN}\nRun \`npm run build\` first.`)
  }
})

describe('MCP smoke', () => {
  it('responds to initialize with serverInfo', async () => {
    await withServer(async (proc, awaitResponse) => {
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0' },
          },
        }) + '\n',
      )
      const reply = await awaitResponse(1)
      expect(reply.result).toBeDefined()
      const result = reply.result as { serverInfo?: { name?: string }; protocolVersion?: string }
      expect(result.serverInfo?.name).toBe('rolepod-wplab')
      expect(result.protocolVersion).toBe('2024-11-05')
    })
  })

  it('returns all v0.0 tools from tools/list', async () => {
    await withServer(async (proc, awaitResponse) => {
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0' },
          },
        }) + '\n',
      )
      await awaitResponse(1)

      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        }) + '\n',
      )

      proc.stdin.write(
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n',
      )

      const reply = await awaitResponse(2)
      const tools = (reply.result as { tools: Array<{ name: string }> }).tools
      const names = tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'rolepod_wp_acf_read',
        'rolepod_wp_cli_run',
        'rolepod_wp_connect_local',
        'rolepod_wp_connect_rest',
        'rolepod_wp_db_query',
        'rolepod_wp_disconnect',
        'rolepod_wp_elementor_read',
        'rolepod_wp_file_read',
        'rolepod_wp_file_write',
        'rolepod_wp_health_check',
        'rolepod_wp_option_get',
        'rolepod_wp_option_set',
        'rolepod_wp_post_create',
        'rolepod_wp_post_get',
        'rolepod_wp_post_list',
        'rolepod_wp_post_update',
        'rolepod_wp_rest_request',
        'rolepod_wp_user_list',
        'rolepod_wp_woo_read',
      ])
    })
  })

  it('returns a structured error for an unknown tool', async () => {
    await withServer(async (proc, awaitResponse) => {
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke', version: '0' },
          },
        }) + '\n',
      )
      await awaitResponse(1)

      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'rolepod_wp_does_not_exist', arguments: {} },
        }) + '\n',
      )

      const reply = await awaitResponse(2)
      const r = reply.result as { isError: boolean; content: Array<{ text: string }> }
      expect(r.isError).toBe(true)
      expect(r.content[0]!.text).toMatch(/Unknown tool/)
    })
  })
})
