import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
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

  return WpFileWriteOutputSchema.parse({
    path: input.path,
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
