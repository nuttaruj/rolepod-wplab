import { checkWpCli } from "../../safety/AllowList.js";
import {
  WpCliRunInputSchema,
  WpCliRunOutputSchema,
  type WpCliRunInput,
  type WpCliRunOutput,
} from "../../schema/tools.js";
import { WpCliBlockedError } from "../../util/errors.js";
import { capStreams } from "../../lib/contentSlice.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCliRunToolDef = {
  name: "rolepod_wp_cli_run",
  description:
    "Run an allow-listed wp-cli subcommand against the target. Set allow_destructive=true to unlock mutating subcommands; hard-blocked subcommands (db reset, db drop, core multisite-convert, eval) never run via this tool, on any target kind. Output is capped at max_bytes per stream (default 64 KB): when truncated=true, narrow the command (`--fields=`, `--format=count`, `--per-page=`) or raise max_bytes.",
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
  // Cap here, not in Target.wpCli() or guardTarget(): those also serve
  // internal callers that JSON.parse the result.
  const capped = capStreams(result.stdout, result.stderr, input.max_bytes);
  return WpCliRunOutputSchema.parse({
    exit_code: result.exitCode,
    stdout: capped.stdout,
    stderr: capped.stderr,
    duration_ms: result.durationMs,
    total_bytes: capped.totalBytes,
    returned_bytes: capped.returnedBytes,
    truncated: capped.truncated,
  });
}
