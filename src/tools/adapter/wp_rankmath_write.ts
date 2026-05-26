import { rankmathAdapter } from "../../adapters/rankmath/read.js";
import {
  rankmathWrite,
  type RankMathWriteFields,
} from "../../adapters/rankmath/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  RankMathWriteInputSchema,
  RankMathWriteOutputSchema,
  type RankMathWriteInput,
  type RankMathWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRankMathWriteToolDef = {
  name: "rolepod_wp_rankmath_write",
  description:
    "Update Rank Math SEO post meta (focus_keyword, meta_description, title, canonical, noindex). At least one field required. Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: RankMathWriteInputSchema,
};

export async function wpRankMathWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<RankMathWriteOutput> {
  const input: RankMathWriteInput = RankMathWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "rankmath_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await rankmathAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Rank Math not active on target",
      { targetId: input.target_id },
    );
  }
  const fields: RankMathWriteFields = {};
  if (input.focus_keyword !== undefined)
    fields.focus_keyword = input.focus_keyword;
  if (input.meta_description !== undefined)
    fields.meta_description = input.meta_description;
  if (input.title !== undefined) fields.title = input.title;
  if (input.canonical !== undefined) fields.canonical = input.canonical;
  if (input.noindex !== undefined) fields.noindex = input.noindex;
  if (Object.keys(fields).length === 0) {
    throw new WplabError(
      "RANKMATH_WRITE_NO_FIELDS",
      "At least one SEO field must be supplied",
      { post_id: input.post_id },
    );
  }
  const result = await rankmathWrite.setPostMeta(target, input.post_id, fields);
  return RankMathWriteOutputSchema.parse({
    post_id: input.post_id,
    updated_fields: result.updated,
    source: result.source,
  });
}
