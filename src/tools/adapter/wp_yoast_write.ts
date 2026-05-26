import { yoastAdapter } from "../../adapters/yoast/read.js";
import {
  yoastWrite,
  type YoastWriteFields,
} from "../../adapters/yoast/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  YoastWriteInputSchema,
  YoastWriteOutputSchema,
  type YoastWriteInput,
  type YoastWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpYoastWriteToolDef = {
  name: "rolepod_wp_yoast_write",
  description:
    "Update Yoast SEO post meta (focus_keyword, meta_description, title, canonical, noindex). At least one field required. Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: YoastWriteInputSchema,
};

export async function wpYoastWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<YoastWriteOutput> {
  const input: YoastWriteInput = YoastWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "yoast_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await yoastAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Yoast SEO not active on target",
      { targetId: input.target_id },
    );
  }
  const fields: YoastWriteFields = {};
  if (input.focus_keyword !== undefined)
    fields.focus_keyword = input.focus_keyword;
  if (input.meta_description !== undefined)
    fields.meta_description = input.meta_description;
  if (input.title !== undefined) fields.title = input.title;
  if (input.canonical !== undefined) fields.canonical = input.canonical;
  if (input.noindex !== undefined) fields.noindex = input.noindex;
  if (Object.keys(fields).length === 0) {
    throw new WplabError(
      "YOAST_WRITE_NO_FIELDS",
      "At least one SEO field must be supplied",
      { post_id: input.post_id },
    );
  }
  const result = await yoastWrite.setPostMeta(target, input.post_id, fields);
  return YoastWriteOutputSchema.parse({
    post_id: input.post_id,
    updated_fields: result.updated,
    source: result.source,
  });
}
