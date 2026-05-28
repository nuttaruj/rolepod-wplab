import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import {
  WpFileWriteBatchInputSchema,
  WpFileWriteBatchOutputSchema,
  type WpFileWriteBatchInput,
  type WpFileWriteBatchOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileWriteBatchToolDef = {
  name: "rolepod_wp_file_write_batch",
  description:
    "Atomic multi-file write. Stages every entry, runs `php -l` on each *.php, walks the cross-file `require`/`include` chain (a missing target is OK if it's in this same batch), then commits all writes via per-file rename. On any failure the whole batch is rolled back from backups. Catches the WSOD class of bugs where you write functions.php before the include it requires exists. Max 100 entries per call. Requires rolepod-wp companion v2.11+.",
  inputSchema: WpFileWriteBatchInputSchema,
};

export async function wpFileWriteBatchHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpFileWriteBatchOutput> {
  const input: WpFileWriteBatchInput = WpFileWriteBatchInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "FS_WRITE_BATCH_UNSUPPORTED_TARGET",
      "file_write_batch is implemented via the rolepod-wp companion REST endpoint and currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }

  const bridge = await bridgeFor(target);
  const result = await bridge.fileWriteBatch(
    input.writes.map((w) => ({
      path: w.path,
      content: w.content,
      mode: w.mode,
      confirmUnsafePath: w.confirm_unsafe_path,
    })),
    { skipPhpLint: input.skip_php_lint },
  );

  // Record one ledger row per written file so the bulk operation is reversible
  // entry-by-entry from the existing change-ledger UI.
  for (const w of result.written) {
    await recordChange(target, {
      category: "file",
      subcategory: w.path,
      targetDescriptor: `batch-write ${w.path} (${w.bytesWritten} bytes, batch ${result.batchId})`,
      beforeState: { absolute_path: w.absolutePath, backup_path: w.backupPath },
      afterState: { absolute_path: w.absolutePath, bytes_written: w.bytesWritten },
      reversible: w.backupPath !== null,
      sourceTool: "wp_file_write_batch",
    });
  }

  return WpFileWriteBatchOutputSchema.parse({
    batch_id: result.batchId,
    written: result.written.map((w) => ({
      path: w.path,
      absolute_path: w.absolutePath,
      bytes_written: w.bytesWritten,
      backup_path: w.backupPath,
    })),
    preflight: {
      php_lint_ran: result.preflight.phpLintRan,
      require_chain_ran: result.preflight.requireChainRan,
      entries_scanned: result.preflight.entriesScanned,
    },
  });
}
