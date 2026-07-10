import { bricksAdapter } from "../../adapters/bricks/read.js";
import {
  bricksWrite,
  assertTemplatePost,
} from "../../adapters/bricks/write.js";
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
    "Replace a Bricks element tree in `_bricks_page_content_2`. scope=page targets a page/post body; scope=header|footer targets a header/footer TEMPLATE, whose post must be a `bricks_template` — a header/footer write to a normal page is refused (BRICKS_WRONG_POST_TYPE), because it shares the page-body meta key and would overwrite it. Requires allow_destructive=true; production guard fires unless confirm=true.",
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
  // header/footer trees share `_bricks_page_content_2` with a page body, so a
  // wrong-post-type write would overwrite page content. Guard before writing.
  await assertTemplatePost(target, input.post_id, input.scope);

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
