import { openTarget } from '../../runtime/factory.js'
import {
  ConnectLocalInputSchema,
  ConnectLocalOutputSchema,
  type ConnectLocalInput,
  type ConnectLocalOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpConnectLocalToolDef = {
  name: 'rolepod_wp_connect_local',
  description:
    'Open a target against a local WordPress install. Returns a target_id used by all subsequent tools. v0.0 supports LocalTarget only.',
  inputSchema: ConnectLocalInputSchema,
}

export async function wpConnectLocalHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ConnectLocalOutput> {
  const input: ConnectLocalInput = ConnectLocalInputSchema.parse(raw)
  const target = await openTarget({ kind: 'local', path: input.path })
  registry.register(target)
  return ConnectLocalOutputSchema.parse({
    target_id: target.id,
    siteurl: target.siteurl,
    wp_version: target.wpVersion,
    ...(target.phpVersion !== undefined ? { php_version: target.phpVersion } : {}),
    companion: target.companion
      ? {
          installed: target.companion.installed,
          version: target.companion.version,
          capabilities: [...target.companion.capabilities],
        }
      : null,
  })
}
