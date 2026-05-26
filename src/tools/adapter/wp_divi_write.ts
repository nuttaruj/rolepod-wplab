import { diviAdapter } from "../../adapters/divi/read.js";
import { diviWrite } from "../../adapters/divi/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  DiviWriteInputSchema,
  DiviWriteOutputSchema,
  type DiviWriteInput,
  type DiviWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpDiviWriteToolDef = {
  name: "rolepod_wp_divi_write",
  description:
    "Replace post_content with a Divi shortcode string. Backs up prior content. Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: DiviWriteInputSchema,
};

export async function wpDiviWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<DiviWriteOutput> {
  const input: DiviWriteInput = DiviWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "divi_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await diviAdapter.detect(target))) {
    throw new WplabError("ADAPTER_NOT_DETECTED", "Divi not active on target", {
      targetId: input.target_id,
    });
  }
  const result = await diviWrite.updatePageContent(
    target,
    input.post_id,
    input.content,
    {
      ensureBuilderFlag: input.ensure_builder_flag,
    },
  );
  return DiviWriteOutputSchema.parse({
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
