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
import { wpPostGetHandler, wpPostGetToolDef } from './atomic/wp_post_get.js'
import { wpPostListHandler, wpPostListToolDef } from './atomic/wp_post_list.js'
import { wpPostCreateHandler, wpPostCreateToolDef } from './atomic/wp_post_create.js'
import { wpPostUpdateHandler, wpPostUpdateToolDef } from './atomic/wp_post_update.js'
import { wpOptionGetHandler, wpOptionGetToolDef } from './atomic/wp_option_get.js'
import { wpOptionSetHandler, wpOptionSetToolDef } from './atomic/wp_option_set.js'
import { wpUserListHandler, wpUserListToolDef } from './atomic/wp_user_list.js'
import { wpDbQueryHandler, wpDbQueryToolDef } from './atomic/wp_db_query.js'
import { wpRestRequestHandler, wpRestRequestToolDef } from './atomic/wp_rest_request.js'
import { wpElementorReadHandler, wpElementorReadToolDef } from './adapter/wp_elementor_read.js'
import { wpWooReadHandler, wpWooReadToolDef } from './adapter/wp_woo_read.js'
import { wpAcfReadHandler, wpAcfReadToolDef } from './adapter/wp_acf_read.js'
import { wpMemoryRecallHandler, wpMemoryRecallToolDef } from './atomic/wp_memory_recall.js'
import { wpMemoryNoteHandler, wpMemoryNoteToolDef } from './atomic/wp_memory_note.js'
import { wpMemoryListHandler, wpMemoryListToolDef } from './atomic/wp_memory_list.js'

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
  {
    def: wpPostGetToolDef,
    handler: (d, raw) => wpPostGetHandler(d.registry, raw),
  },
  {
    def: wpPostListToolDef,
    handler: (d, raw) => wpPostListHandler(d.registry, raw),
  },
  {
    def: wpPostCreateToolDef,
    handler: (d, raw) => wpPostCreateHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpPostUpdateToolDef,
    handler: (d, raw) => wpPostUpdateHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpOptionGetToolDef,
    handler: (d, raw) => wpOptionGetHandler(d.registry, raw),
  },
  {
    def: wpOptionSetToolDef,
    handler: (d, raw) => wpOptionSetHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpUserListToolDef,
    handler: (d, raw) => wpUserListHandler(d.registry, raw),
  },
  {
    def: wpDbQueryToolDef,
    handler: (d, raw) => wpDbQueryHandler(d.registry, d.prodGuard, raw),
  },
  {
    def: wpRestRequestToolDef,
    handler: (d, raw) => wpRestRequestHandler(d.registry, raw),
  },
  {
    def: wpElementorReadToolDef,
    handler: (d, raw) => wpElementorReadHandler(d.registry, raw),
  },
  {
    def: wpWooReadToolDef,
    handler: (d, raw) => wpWooReadHandler(d.registry, raw),
  },
  {
    def: wpAcfReadToolDef,
    handler: (d, raw) => wpAcfReadHandler(d.registry, raw),
  },
  {
    def: wpMemoryRecallToolDef,
    handler: (d, raw) => wpMemoryRecallHandler(d.registry, raw),
  },
  {
    def: wpMemoryNoteToolDef,
    handler: (d, raw) => wpMemoryNoteHandler(d.registry, raw),
  },
  {
    def: wpMemoryListToolDef,
    handler: (d, raw) => wpMemoryListHandler(d.registry, raw),
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
