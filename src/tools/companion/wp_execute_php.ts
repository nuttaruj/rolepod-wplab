import { bridgeFor } from '../../companion/Bridge.js'
import { loadProfile } from '../../profile/load.js'
import { PowerProfileRequiredError, WplabError } from '../../util/errors.js'
import {
  ExecutePhpInputSchema,
  ExecutePhpOutputSchema,
  type ExecutePhpInput,
  type ExecutePhpOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpExecutePhpToolDef = {
  name: 'rolepod_wp_execute_php',
  description:
    'Run a PHP payload inside the live WordPress request lifecycle via the companion endpoint. Requires: companion installed + ROLEPOD_WPLAB_PROFILE=power + target not production-matched + confirm:true. Payload passes Node-side AST screen (token blocklist) + companion-side AST re-screen. Every call audit-logged on disk.',
  inputSchema: ExecutePhpInputSchema,
}

export async function wpExecutePhpHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ExecutePhpOutput> {
  const input: ExecutePhpInput = ExecutePhpInputSchema.parse(raw)

  // Profile check
  const profile = loadProfile()
  if (profile.profile !== 'power') {
    throw new PowerProfileRequiredError()
  }

  const target = registry.get(input.target_id)
  const bridge = await bridgeFor(target)

  const opts: { timeoutMs?: number } = {}
  if (input.timeout_ms !== undefined) opts.timeoutMs = input.timeout_ms

  const result = await bridge.executePhp(input.payload, opts)

  if (!result.ok) {
    throw new WplabError(
      result.error_message?.startsWith('AST_REJECTED') ? 'AST_REJECTED' : 'EXECUTE_PHP_FAILED',
      result.error_message ?? 'execute-php failed',
      { audit_id: result.audit_id },
    )
  }

  return ExecutePhpOutputSchema.parse({
    ok: true,
    return_value: result.return_value,
    stdout: result.stdout ?? '',
    duration_ms: result.duration_ms ?? 0,
    php_warnings: result.php_warnings ?? [],
    audit_id: result.audit_id,
  })
}
