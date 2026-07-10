import { execa } from "execa";
import { WpCliNotFoundError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { WpCliOpts, WpCliResult } from "./Target.js";

const DEFAULT_TIMEOUT = 30_000;

/**
 * Run a wp-cli subcommand against a local WP install root.
 *
 * No allow-list here. The user-facing allow-list lives in the
 * `rolepod_wp_cli_run` handler so it covers every target kind, and the
 * catastrophic-command floor lives in `guardTarget()` so it covers every
 * caller. Enforcing it a third time in this function would only reach
 * LocalTarget, and would break internal callers that need `eval`.
 */
export async function runWpCli(
  wpPath: string,
  args: readonly string[],
  opts: WpCliOpts = {},
): Promise<WpCliResult> {
  const finalArgs = ["--path=" + wpPath, "--no-color", ...args];
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const started = Date.now();

  log.debug("wp-cli invoke", { args: finalArgs, timeoutMs });

  try {
    const result = await execa("wp", finalArgs, {
      reject: false,
      timeout: timeoutMs,
      cwd: opts.cwd ?? wpPath,
      env: {
        ...process.env,
        WP_CLI_DISABLE_AUTO_CHECK_UPDATE: "1",
        // Silence PHP deprecation noise from wp-cli phar on PHP 8.4+; keeps
        // stdout free of warning lines that pollute parsed responses.
        WP_CLI_PHP_ARGS:
          `${process.env["WP_CLI_PHP_ARGS"] ?? ""} -d error_reporting=E_ERROR -d display_startup_errors=0`.trim(),
      },
    });
    const duration = Date.now() - started;
    return {
      exitCode: result.exitCode ?? -1,
      stdout: stripPhpNoise(result.stdout ?? ""),
      stderr: stripPhpNoise(result.stderr ?? ""),
      durationMs: duration,
    };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw new WpCliNotFoundError();
    }
    throw err;
  }
}

/**
 * Strip PHP deprecation / warning lines + leading blank lines from wp-cli
 * output. wp-cli 2.12.x on PHP 8.4+ emits a `Deprecated:` notice from its own
 * phar that wp-cli does not suppress; leaking it into our parsed output would
 * break every downstream JSON.parse() / single-value read.
 *
 * Removed line prefixes:
 *   - PHP Deprecated: …
 *   - Deprecated: …
 *   - PHP Warning: …
 *   - Warning: …
 *   - PHP Notice: …
 *   - Notice: …
 *
 * Leading + trailing blank lines are also trimmed.
 */
export function stripPhpNoise(s: string): string {
  if (!s) return s;
  const kept: string[] = [];
  for (const line of s.split("\n")) {
    if (
      /^(?:PHP\s+)?(?:Deprecated|Warning|Notice|Strict Standards):/i.test(line)
    ) {
      continue;
    }
    kept.push(line);
  }
  // collapse runs of blank lines + trim
  return kept.join("\n").replace(/^\s+|\s+$/g, "");
}

/**
 * Cheap availability probe: `wp --info` returns 0 if wp-cli is installed.
 * Used by doctor + LocalTarget connect.
 */
export async function wpCliAvailable(): Promise<{
  ok: boolean;
  version: string | null;
}> {
  try {
    const result = await execa("wp", ["--info", "--no-color"], {
      reject: false,
      timeout: 5_000,
    });
    if (result.exitCode !== 0) return { ok: false, version: null };
    const match = /WP-CLI version:\s+(\S+)/i.exec(result.stdout);
    return { ok: true, version: match?.[1] ?? null };
  } catch {
    return { ok: false, version: null };
  }
}
