import { checkWpCli } from "../../safety/AllowList.js";
import {
  WpCliRunInputSchema,
  WpCliRunOutputSchema,
  type WpCliRunInput,
  type WpCliRunOutput,
} from "../../schema/tools.js";
import { WpCliBlockedError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCliRunToolDef = {
  name: "rolepod_wp_cli_run",
  description:
    "Run an allow-listed wp-cli subcommand against the target. Set allow_destructive=true to unlock mutating subcommands; hard-blocked subcommands (db reset, db drop, core multisite-convert, eval) never run via this tool, on any target kind.",
  inputSchema: WpCliRunInputSchema,
};

export async function wpCliRunHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpCliRunOutput> {
  const input: WpCliRunInput = WpCliRunInputSchema.parse(raw);

  // The allow-list is enforced here, before dispatch, so it applies to every
  // target kind. Runtime-level enforcement would only cover LocalTarget, and
  // would also block the internal callers that legitimately need `eval`.
  const verdict = checkWpCli(input.args, input.allow_destructive);
  if (!verdict.allowed) {
    throw new WpCliBlockedError([...input.args], verdict.kind);
  }

  const target = registry.get(input.target_id);
  const result = await target.wpCli(input.args, {
    allowDestructive: input.allow_destructive,
    timeoutMs: input.timeout_ms,
  });
  return WpCliRunOutputSchema.parse({
    exit_code: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    duration_ms: result.durationMs,
  });
}
