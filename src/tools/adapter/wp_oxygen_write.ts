import { oxygenAdapter } from "../../adapters/oxygen/read.js";
import { oxygenWrite } from "../../adapters/oxygen/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  OxygenWriteInputSchema,
  OxygenWriteOutputSchema,
  type OxygenWriteInput,
  type OxygenWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpOxygenWriteToolDef = {
  name: "rolepod_wp_oxygen_write",
  description:
    "Replace ct_builder_shortcodes post meta with new Oxygen shortcode payload. Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: OxygenWriteInputSchema,
};

export async function wpOxygenWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<OxygenWriteOutput> {
  const input: OxygenWriteInput = OxygenWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "oxygen_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await oxygenAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Oxygen not active on target",
      { targetId: input.target_id },
    );
  }
  const result = await oxygenWrite.updatePageShortcodes(
    target,
    input.post_id,
    input.shortcodes,
  );
  return OxygenWriteOutputSchema.parse({
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
