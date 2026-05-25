import {
  DisconnectInputSchema,
  DisconnectOutputSchema,
  type DisconnectInput,
  type DisconnectOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpDisconnectToolDef = {
  name: 'rolepod_wp_disconnect',
  description:
    'Explicitly close a connected target — releases its registry slot, revokes the companion session token (when applicable), and prevents idle-timeout race conditions on cleanup.',
  inputSchema: DisconnectInputSchema,
}

export async function wpDisconnectHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<DisconnectOutput> {
  const input: DisconnectInput = DisconnectInputSchema.parse(raw)
  await registry.disconnect(input.target_id)
  return DisconnectOutputSchema.parse({ closed: true })
}
