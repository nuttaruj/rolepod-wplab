import { recordChange } from "./ledger.js";
import type { ChangeRecord } from "./ledger.js";
import { bridgeFor } from "./Bridge.js";
import { flushObjectCache } from "./cacheFlush.js";
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import { checkRequireChain, isBootstrapPath } from "../lib/requireChain.js";
import type { Target } from "../runtime/Target.js";

export interface ManagedWriteOpts {
  mode?: "overwrite" | "append" | undefined;
  backup?: boolean | undefined;
  confirmUnsafePath?: boolean | undefined;
  /** MCP tool name for the ledger row. */
  sourceTool: string;
  /** Ledger category — defaults to "file". */
  category?: ChangeRecord["category"] | undefined;
}

export interface ManagedWriteResult {
  bytesWritten: number;
  backupPath: string | null;
  absolutePath: string;
}

/**
 * The managed file-write pipeline, shared by rolepod_wp_file_write and the
 * scaffold composites: pre-write validation (php -l / JSON parse / require-chain
 * on rest+companion targets), before-state snapshot, the actual write, a ledger
 * row (rest targets only — recordChange no-ops elsewhere), and a Site-Editor
 * object-cache flush after theme.json writes.
 *
 * It does NOT enforce the production guard — that is the caller's decision (a
 * scaffold may want confirm-based prod gating, file_write hard-blocks prod).
 */
export async function writeManagedFile(
  target: Target,
  path: string,
  content: string,
  opts: ManagedWriteOpts,
): Promise<ManagedWriteResult> {
  await preWriteValidate(target, path, content);

  // Snapshot prior content if it exists, so revert can restore it.
  let beforeContent: string | null = null;
  try {
    const r = await target.fileRead(path);
    beforeContent = r.content;
  } catch {
    /* file did not exist — revert = delete */
  }

  const fwOpts: {
    mode?: "overwrite" | "append";
    backup?: boolean;
    confirmUnsafePath?: boolean;
  } = {};
  if (opts.mode !== undefined) fwOpts.mode = opts.mode;
  if (opts.backup !== undefined) fwOpts.backup = opts.backup;
  if (opts.confirmUnsafePath !== undefined)
    fwOpts.confirmUnsafePath = opts.confirmUnsafePath;
  const result = await target.fileWrite(path, content, fwOpts);

  await recordChange(target, {
    category: opts.category ?? "file",
    subcategory: path,
    targetDescriptor: `write ${path} (${result.bytesWritten} bytes)`,
    beforeState:
      beforeContent !== null
        ? { absolute_path: result.absolutePath, content: beforeContent }
        : { absolute_path: result.absolutePath, content: null },
    afterState: {
      absolute_path: result.absolutePath,
      content,
      backup_path: result.backupPath,
    },
    reversible: true,
    sourceTool: opts.sourceTool,
  });

  // Site Editor caches the resolved theme.json into the object cache; without a
  // flush the editor sees stale data on next reload.
  if (path.toLowerCase().endsWith("theme.json")) {
    await flushObjectCache(target);
  }

  return {
    bytesWritten: result.bytesWritten,
    backupPath: result.backupPath,
    absolutePath: result.absolutePath,
  };
}

/**
 * Pre-write validator. Detects language by file extension:
 *   *.php → companion `php -l` (server-side, authoritative) + require-chain
 *   *.json → client-side JSON.parse
 *
 * Throws WplabError on a genuine validation failure so the write never runs.
 * Infra failures (exec disabled, host down) are logged, not thrown — the safety
 * net is best-effort. On non-rest targets the PHP checks return early (the
 * companion validator is REST-only).
 */
export async function preWriteValidate(
  target: Target,
  path: string,
  content: string,
): Promise<void> {
  const lower = path.toLowerCase();

  if (lower.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (err) {
      throw new WplabError(
        "FS_WRITE_JSON_INVALID",
        `client-side JSON.parse failed: ${(err as Error).message}`,
        { path },
      );
    }
  }

  if (lower.endsWith(".php")) {
    if (target.kind !== "rest") return;

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
          "managed write: companion syntax check unavailable, proceeding",
          { path, reason: result.errorCode },
        );
      }
    } catch (err) {
      if (
        err instanceof WplabError &&
        err.code === "FS_WRITE_PHP_SYNTAX_ERROR"
      ) {
        throw err;
      }
      log.debug(
        "managed write: pre-write PHP validation skipped on infra error",
        {
          path,
          reason: (err as Error).message,
        },
      );
    }

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
              `Resolution: write the required files FIRST (or use rolepod_wp_file_write_batch to stage the whole set atomically), then retry.`,
            ].join("\n"),
            { path, missing: result.missing },
          );
        }
      } catch (err) {
        if (
          err instanceof WplabError &&
          err.code === "FS_WRITE_REQUIRE_CHAIN_BROKEN"
        ) {
          throw err;
        }
        log.debug("managed write: require chain check skipped on infra error", {
          path,
          reason: (err as Error).message,
        });
      }
    }
  }
}
