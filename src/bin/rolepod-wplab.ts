#!/usr/bin/env node
import { createServer } from '../server.js'
import { runDoctor } from './doctor.js'
import { runCredentials } from './credentials.js'
import { runMemory } from './memory.js'
import { log } from '../util/log.js'

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'serve'

  switch (cmd) {
    case 'doctor': {
      const code = await runDoctor()
      process.exit(code)
      // unreachable, but TS doesn't know
      return
    }
    case 'credentials':
    case 'creds': {
      const code = await runCredentials(process.argv.slice(3))
      process.exit(code)
      return
    }
    case 'memory':
    case 'mem': {
      const code = await runMemory(process.argv.slice(3))
      process.exit(code)
      return
    }
    case 'smoke': {
      // v0.1+ — needs docker fixture
      console.error('[wplab] smoke test lands in v0.1')
      process.exit(2)
      return
    }
    case 'serve':
    case '--stdio':
    case undefined: {
      const { shutdown } = await createServer()

      const onSignal = (signal: NodeJS.Signals) => {
        log.info(`signal received — closing targets`, { signal })
        shutdown()
          .then(() => process.exit(0))
          .catch((err: unknown) => {
            log.error('shutdown error', { err: (err as Error).message })
            process.exit(1)
          })
      }

      process.on('SIGINT', onSignal)
      process.on('SIGTERM', onSignal)
      return
    }
    default: {
      console.error(`[wplab] unknown command: ${cmd}`)
      console.error('Usage: rolepod-wplab [serve|doctor|smoke]')
      process.exit(2)
    }
  }
}

main().catch((err: unknown) => {
  log.error('fatal', { err: (err as Error).message, stack: (err as Error).stack })
  process.exit(1)
})
