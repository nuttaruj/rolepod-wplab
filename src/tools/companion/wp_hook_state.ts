import { bridgeFor } from '../../companion/Bridge.js'
import {
  HookStateInputSchema,
  HookStateOutputSchema,
  type HookStateInput,
  type HookStateOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpHookStateToolDef = {
  name: 'rolepod_wp_hook_state',
  description:
    'List callbacks registered on a specific WordPress hook (action or filter) ordered by priority. Wraps rolepod_wp_introspect { scope: hooks } and filters by hook name. Useful for "why isn\'t this hook firing?" debugging.',
  inputSchema: HookStateInputSchema,
}

export async function wpHookStateHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<HookStateOutput> {
  const input: HookStateInput = HookStateInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const bridge = await bridgeFor(target)
  const report = await bridge.introspect('hooks')
  const all = (report['hooks'] ?? {}) as Record<string, Array<{ priority: number; callback_identifier: string }>>
  const callbacks = all[input.hook] ?? []
  return HookStateOutputSchema.parse({
    hook: input.hook,
    kind: input.kind,
    callbacks,
  })
}
