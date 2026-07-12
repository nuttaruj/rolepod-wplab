import { ProdGuard } from "../../safety/ProdGuard.js";
import { writeManagedFile } from "../../companion/managedWrite.js";
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

  // The managed pipeline handles pre-write validation (php -l / JSON /
  // require-chain), the before-state snapshot, the write, the ledger row, and
  // the theme.json cache flush. Validation failure blocks the write — the
  // failure mode (WSOD on functions.php, Site Editor white-page on theme.json)
  // is invisible and recoverable only via SSH/FTP.
  const result = await writeManagedFile(target, input.path, input.content, {
    mode: input.mode,
    backup: input.backup,
    confirmUnsafePath: input.confirm_unsafe_path,
    sourceTool: "wp_file_write",
  });

  return WpFileWriteOutputSchema.parse({
    path: input.path,
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
