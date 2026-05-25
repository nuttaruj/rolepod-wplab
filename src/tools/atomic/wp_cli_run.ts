import {
  WpCliRunInputSchema,
  WpCliRunOutputSchema,
  type WpCliRunInput,
  type WpCliRunOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpCliRunToolDef = {
  name: 'rolepod_wp_cli_run',
  description:
    'Run an allow-listed wp-cli subcommand against the target. Set allow_destructive=true to unlock mutating subcommands; hard-blocked subcommands (db reset, db drop, core multisite-convert) never run via this tool.',
  inputSchema: WpCliRunInputSchema,
}

export async function wpCliRunHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpCliRunOutput> {
  const input: WpCliRunInput = WpCliRunInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const result = await target.wpCli(input.args, {
    allowDestructive: input.allow_destructive,
    timeoutMs: input.timeout_ms,
  })
  return WpCliRunOutputSchema.parse({
    exit_code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration_ms: result.durationMs,
  })
}
