import { openTarget } from '../../runtime/factory.js'
import type { SshTargetOptions } from '../../runtime/SshTarget.js'
import {
  ConnectSshInputSchema,
  ConnectSshOutputSchema,
  type ConnectSshInput,
  type ConnectSshOutput,
} from '../../schema/tools.js'
import { WplabError } from '../../util/errors.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpConnectSshToolDef = {
  name: 'rolepod_wp_connect_ssh',
  description:
    'Open a target against a remote WordPress over SSH (v0.3). Requires either private_key_path (preferred) or password. wp-cli must be on PATH on the remote host. REST endpoint not bound to this target — use connect_rest for REST against the same site.',
  inputSchema: ConnectSshInputSchema,
}

export async function wpConnectSshHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ConnectSshOutput> {
  const input: ConnectSshInput = ConnectSshInputSchema.parse(raw)
  if (!input.private_key_path && !input.password) {
    throw new WplabError('SSH_NO_AUTH', 'connect_ssh requires private_key_path or password', {})
  }
  const opts: SshTargetOptions = {
    host: input.host,
    user: input.user,
    wpPath: input.wp_path,
    port: input.port,
  }
  if (input.private_key_path !== undefined) opts.privateKeyPath = input.private_key_path
  if (input.password !== undefined) opts.password = input.password

  const target = await openTarget({ kind: 'ssh', options: opts })
  registry.register(target)

  return ConnectSshOutputSchema.parse({
    target_id: target.id,
    siteurl: target.siteurl,
    wp_version: target.wpVersion,
  })
}
