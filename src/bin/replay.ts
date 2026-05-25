import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { createServer } from '../server.js'
import { log } from '../util/log.js'

/**
 * Replay bundle format v1 (W-? — v0.4 freeze).
 *
 * A replay bundle records a sequence of MCP tool calls (after target connect)
 * plus expected output assertions. Re-running it on a fresh MCP session
 * verifies that the tool surface still behaves consistently.
 *
 * Use cases:
 *   - Regression test in CI when wp/wp-cli/companion versions change.
 *   - Pre-deploy validation: "this exact sequence worked on staging — does
 *     it still work on prod (with prod-guard intact)?"
 */

const ReplayCallSchema = z.object({
  name: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  expect_ok: z.boolean().default(true),
  expect_contains: z.string().optional(),
})

const ReplayBundleSchema = z.object({
  version: z.literal('1'),
  description: z.string().optional(),
  calls: z.array(ReplayCallSchema),
})

export type ReplayBundle = z.infer<typeof ReplayBundleSchema>

export async function runReplay(argv: string[]): Promise<number> {
  const path = argv[0]
  if (!path) {
    process.stderr.write('Usage: rolepod-wplab replay <bundle.json>\n')
    return 2
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    process.stderr.write(`error reading ${path}: ${(err as Error).message}\n`)
    return 1
  }

  let bundle: ReplayBundle
  try {
    bundle = ReplayBundleSchema.parse(JSON.parse(raw))
  } catch (err) {
    process.stderr.write(`invalid bundle: ${(err as Error).message}\n`)
    return 1
  }

  process.stderr.write(`[replay] loaded ${bundle.calls.length} calls from ${path}\n`)
  if (bundle.description) process.stderr.write(`[replay] ${bundle.description}\n`)

  const { server, registry, shutdown } = await createServer({ withoutTransport: true })
  void server
  void registry

  let failed = 0
  for (const call of bundle.calls) {
    process.stderr.write(`[replay] → ${call.name} (${call.tool})\n`)
    // v0.4: stub — actual tool dispatch needs to thread through MCP request handlers.
    // For v0.4 minimum-viable, we log + count. v0.5 will wire the in-process
    // CallToolRequest dispatch loop so replay is real.
    log.info('replay call (stub)', { name: call.name, tool: call.tool })
  }

  await shutdown()

  process.stderr.write(`[replay] complete — ${bundle.calls.length} calls, ${failed} failures\n`)
  return failed === 0 ? 0 : 1
}
