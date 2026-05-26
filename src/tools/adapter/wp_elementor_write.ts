import { elementorAdapter } from "../../adapters/elementor/read.js";
import { elementorWrite } from "../../adapters/elementor/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  ElementorWriteInputSchema,
  ElementorWriteOutputSchema,
  type ElementorWriteInput,
  type ElementorWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorWriteToolDef = {
  name: "rolepod_wp_elementor_write",
  description:
    "Replace an Elementor page widget tree (`_elementor_data` post meta). Requires allow_destructive=true. Production guard fires unless confirm=true. Backup written under wp-content/uploads/wplab-backups/ before overwrite.",
  inputSchema: ElementorWriteInputSchema,
};

export async function wpElementorWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<ElementorWriteOutput> {
  const input: ElementorWriteInput = ElementorWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "elementor_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  const detected = await elementorAdapter.detect(target);
  if (!detected) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Elementor not active on target",
      { targetId: input.target_id },
    );
  }
  const result = await elementorWrite.updatePageData(
    target,
    input.post_id,
    input.widget_tree,
  );
  return ElementorWriteOutputSchema.parse({
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
