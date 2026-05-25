import { z } from 'zod'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { zodToJsonSchema } from './zodToJsonSchema.js'
import type { ProdGuard } from '../safety/ProdGuard.js'
import type { TargetRegistry } from '../target/TargetRegistry.js'
import { WplabError } from '../util/errors.js'
import { log } from '../util/log.js'
import { wpConnectLocalHandler, wpConnectLocalToolDef } from './atomic/wp_connect_local.js'
import { wpConnectRestHandler, wpConnectRestToolDef } from './atomic/wp_connect_rest.js'
import { wpDisconnectHandler, wpDisconnectToolDef } from './atomic/wp_disconnect.js'
import { wpCliRunHandler, wpCliRunToolDef } from './atomic/wp_cli_run.js'
import { wpHealthCheckHandler, wpHealthCheckToolDef } from './atomic/wp_health_check.js'
import { wpFileReadHandler, wpFileReadToolDef } from './atomic/wp_file_read.js'
import { wpFileWriteHandler, wpFileWriteToolDef } from './atomic/wp_file_write.js'

type RegisterDeps = {
  registry: TargetRegistry
  prodGuard: ProdGuard
}

type ToolDef = {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
}

type Handler = (deps: RegisterDeps, raw: unknown) => Promise<unknown>

const TOOLS: Array<{ def: ToolDef; handler: Handler }> = [
  {
    def: wpConnectLocalToolDef,
    handler: (d, raw) => wpConnectLocalHandler(d.registry, raw),
  },
  {
    def: wpConnectRestToolDef,
    handler: (d, raw) => wpConnectRestHandler(d.registry, raw),
  },
  {
    def: wpDisconnectToolDef,
    handler: (d, raw) => wpDisconnectHandler(d.registry, raw),
  },
  {
    def: wpCliRunToolDef,
    handler: (d, raw) => wpCliRunHandler(d.registry, raw),
  },
  {
    def: wpHealthCheckToolDef,
    handler: (d, raw) => wpHealthCheckHandler(d.registry, raw),
  },
  {
    def: wpFileReadToolDef,
    handler: (d, raw) => wpFileReadHandler(d.registry, raw),
  },
  {
    def: wpFileWriteToolDef,
    handler: (d, raw) => wpFileWriteHandler(d.registry, d.prodGuard, raw),
  },
]

export function registerTools(server: Server, deps: RegisterDeps): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ def }) => ({
      name: def.name,
      description: def.description,
      inputSchema: zodToJsonSchema(def.inputSchema),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = TOOLS.find(({ def }) => def.name === req.params.name)
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Unknown tool: ${req.params.name}` }],
      }
    }
    try {
      const result = await tool.handler(deps, req.params.arguments ?? {})
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      }
    } catch (err) {
      const wplabErr = err instanceof WplabError ? err.toJSON() : null
      const message = wplabErr
        ? JSON.stringify({ ok: false, error: wplabErr }, null, 2)
        : `Internal error: ${(err as Error).message}`
      log.warn('tool call failed', { tool: req.params.name, message })
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
      }
    }
  })
}
