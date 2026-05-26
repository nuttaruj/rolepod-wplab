import { acfAdapter } from "../../adapters/acf/read.js";
import { acfWrite } from "../../adapters/acf/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  AcfWriteInputSchema,
  AcfWriteOutputSchema,
  type AcfWriteInput,
  type AcfWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpAcfWriteToolDef = {
  name: "rolepod_wp_acf_write",
  description:
    "Update an ACF field on a post. Tries ACF Pro REST first (works on RestTarget), falls back to wp-cli post meta update. Requires allow_destructive=true. Production guard fires unless confirm=true.",
  inputSchema: AcfWriteInputSchema,
};

export async function wpAcfWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<AcfWriteOutput> {
  const input: AcfWriteInput = AcfWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "acf_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await acfAdapter.detect(target))) {
    throw new WplabError("ADAPTER_NOT_DETECTED", "ACF not active on target", {
      targetId: input.target_id,
    });
  }
  const result = await acfWrite.setPostMeta(
    target,
    input.post_id,
    input.field_name,
    input.value,
  );
  return AcfWriteOutputSchema.parse({
    source: result.source,
    post_id: input.post_id,
    field_name: input.field_name,
  });
}
