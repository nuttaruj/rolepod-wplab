import { bricksAdapter } from "../../adapters/bricks/read.js";
import { bricksWrite } from "../../adapters/bricks/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  BricksWriteInputSchema,
  BricksWriteOutputSchema,
  type BricksWriteInput,
  type BricksWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpBricksWriteToolDef = {
  name: "rolepod_wp_bricks_write",
  description:
    "Replace Bricks page/header/footer element tree (_bricks_page_content_2 / _bricks_header_content / _bricks_footer_content). Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: BricksWriteInputSchema,
};

export async function wpBricksWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<BricksWriteOutput> {
  const input: BricksWriteInput = BricksWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "bricks_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await bricksAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Bricks not active on target",
      { targetId: input.target_id },
    );
  }
  const op =
    input.scope === "header"
      ? bricksWrite.updateHeaderContent
      : input.scope === "footer"
        ? bricksWrite.updateFooterContent
        : bricksWrite.updatePageContent;
  const result = await op(target, input.post_id, input.elements);
  return BricksWriteOutputSchema.parse({
    scope: input.scope,
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
  });
}
