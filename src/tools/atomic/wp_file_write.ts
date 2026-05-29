import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { flushObjectCache } from "../../companion/cacheFlush.js";
import { WplabError } from "../../util/errors.js";
import { log } from "../../util/log.js";
import { checkRequireChain, isBootstrapPath } from "../../lib/requireChain.js";
import {
  WpFileWriteInputSchema,
  WpFileWriteOutputSchema,
  type WpFileWriteInput,
  type WpFileWriteOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileWriteToolDef = {
  name: "rolepod_wp_file_write",
  description:
    "Write a file under wp-content/themes|plugins|uploads/ or wp-config.php on the target. Writes outside that scope require confirm_unsafe_path=true. Backups are created by default.",
  inputSchema: WpFileWriteInputSchema,
};

export async function wpFileWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpFileWriteOutput> {
  const input: WpFileWriteInput = WpFileWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // Production guard — file writes on prod targets refused.
  prodGuard.enforce(target.siteurl);

  // ── v2.4 pre-write syntax validation ──
  // PHP files: companion runs `php -l` server-side.
  // JSON files: validated client-side (cheap) AND server-side (authoritative).
  // Validation failure ALWAYS blocks the write — no opt-out, because the
  // failure mode (WSOD on functions.php, Site Editor white-page on theme.json)
  // is invisible and recoverable only via SSH/FTP. If the host has exec()
  // disabled, the PHP check returns null and we fall back gracefully.
  await preWriteValidate(target, input.path, input.content);

  // Snapshot the prior content if it exists, so revert can restore it.
  let beforeContent: string | null = null;
  try {
    const r = await target.fileRead(input.path);
    beforeContent = r.content;
  } catch {
    /* file did not exist — revert = delete */
  }

  const result = await target.fileWrite(input.path, input.content, {
    mode: input.mode,
    backup: input.backup,
    confirmUnsafePath: input.confirm_unsafe_path,
  });

  await recordChange(target, {
    category: "file",
    subcategory: input.path,
    targetDescriptor: `write ${input.path} (${result.bytesWritten} bytes)`,
    beforeState:
      beforeContent !== null
        ? { absolute_path: result.absolutePath, content: beforeContent }
        : { absolute_path: result.absolutePath, content: null },
    afterState: {
      absolute_path: result.absolutePath,
      content: input.content,
      backup_path: result.backupPath,
    },
    reversible: true,
    sourceTool: "wp_file_write",
  });

  // Site Editor cache flush after theme.json writes — block themes cache the
  // resolved theme.json into the object cache; without flush the editor sees
  // stale data on next reload.
  if (
    input.path.toLowerCase().endsWith("/theme.json") ||
    input.path.toLowerCase().endsWith("theme.json")
  ) {
    await flushObjectCache(target);
  }

  return WpFileWriteOutputSchema.parse({
    path: input.path,
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}

/**
 * Pre-write validator. Detects language by file extension:
 *   *.php → companion `php -l` (server-side, authoritative)
 *   *.json + *.theme.json → client-side JSON.parse + server-side companion check
 *
 * Throws WplabError on failure so the file_write never executes. The error
 * carries the line + message for the user to see exactly what's wrong.
 *
 * For non-validatable extensions (.css, .html, .js, .png, etc.) returns
 * immediately — no validation possible, write proceeds.
 *
 * Failures from the companion side (exec disabled, host unavailable) are
 * NOT thrown — we log a debug line and let the write proceed. The safety
 * net here is best-effort, not gate-keeping.
 */
async function preWriteValidate(
  target: Parameters<typeof recordChange>[0],
  path: string,
  content: string,
): Promise<void> {
  const lower = path.toLowerCase();

  // JSON — client-side parse first (free + immediate).
  if (lower.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (err) {
      const e = err as Error;
      throw new WplabError(
        "FS_WRITE_JSON_INVALID",
        `client-side JSON.parse failed: ${e.message}`,
        { path },
      );
    }
  }

  // PHP — companion-side `php -l`. Skip on non-rest targets (Local/SSH/Docker
  // have their own runtime; companion validator is REST-only).
  if (lower.endsWith(".php")) {
    if (target.kind !== "rest") return;

    // (a) Syntax check via companion.
    try {
      const bridge = await bridgeFor(target);
      const result = await bridge.syntaxCheck("php", content);
      if (result.ok === false) {
        throw new WplabError(
          "FS_WRITE_PHP_SYNTAX_ERROR",
          `companion php -l rejected the payload (line ${result.errorLine ?? "?"}): ${result.errorMessage ?? "unknown"}`,
          {
            path,
            error_code: result.errorCode,
            error_line: result.errorLine,
            error_message: result.errorMessage,
          },
        );
      }
      if (result.ok === null) {
        log.debug(
          "file_write: companion syntax check unavailable, proceeding",
          {
            path,
            reason: result.errorCode,
          },
        );
      }
    } catch (err) {
      // Re-throw our own validation errors. Swallow infra errors so the user
      // isn't blocked by a transient companion problem.
      if (
        err instanceof WplabError &&
        err.code === "FS_WRITE_PHP_SYNTAX_ERROR"
      ) {
        throw err;
      }
      log.debug("file_write: pre-write PHP validation skipped on infra error", {
        path,
        reason: (err as Error).message,
      });
    }

    // (b) Require/include chain resolution for bootstrap files. A missing
    //     `require_once` at boot time fatals the entire site — guard against
    //     ordering bugs where the AI writes functions.php before the file
    //     it requires exists. Best-effort: skips paths it cannot resolve
    //     statically, never throws on infra errors.
    if (isBootstrapPath(path)) {
      try {
        const result = await checkRequireChain(target, path, content);
        if (result.missing.length > 0) {
          const lines = result.missing.map(
            (m) =>
              `  - require '${m.required_path}' → ${m.resolved_path} (line ${m.line_hint ?? "?"})`,
          );
          throw new WplabError(
            "FS_WRITE_REQUIRE_CHAIN_BROKEN",
            [
              `${path} requires files that do not exist on the target. Writing this would fatal the site at first load.`,
              ``,
              `Missing requires:`,
              ...lines,
              ``,
              `Resolution: write the required files FIRST (or use the upcoming rolepod_wp_file_write_batch tool to stage the whole set atomically), then retry.`,
            ].join("\n"),
            {
              path,
              missing: result.missing,
            },
          );
        }
      } catch (err) {
        if (
          err instanceof WplabError &&
          err.code === "FS_WRITE_REQUIRE_CHAIN_BROKEN"
        ) {
          throw err;
        }
        log.debug("file_write: require chain check skipped on infra error", {
          path,
          reason: (err as Error).message,
        });
      }
    }
  }
}
