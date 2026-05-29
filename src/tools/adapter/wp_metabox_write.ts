import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const MetaBoxWriteInputSchema = z.object({
  target_id: z.string(),
  scope: z.literal("post_meta"),
  post_id: z.number().int().positive(),
  meta: z.record(z.string(), z.unknown()),
});

export const wpMetaboxWriteToolDef = {
  name: "rolepod_wp_metabox_write",
  description:
    "Write Meta Box (metabox.io) post meta on a connected target. v1.8 supports scope=post_meta only — pass { post_id, meta: {field_id: value, ...} }. The plugin's fields must be register_meta'd with show_in_rest=true (Meta Box does this automatically for most field types). Auto-ledgered.",
  inputSchema: MetaBoxWriteInputSchema,
};

export async function wpMetaboxWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<unknown> {
  const input = MetaBoxWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  let beforeMeta: unknown = null;
  try {
    const pre = await target.rest({
      method: "GET",
      path: `/wp/v2/posts/${input.post_id}?context=edit`,
    });
    beforeMeta = ((pre.body ?? {}) as Record<string, unknown>)["meta"] ?? null;
  } catch {
    /* swallow */
  }

  const res = await target.rest({
    method: "POST",
    path: `/wp/v2/posts/${input.post_id}`,
    body: { meta: input.meta },
  });

  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "METABOX_WRITE_FAILED",
      `REST returned HTTP ${res.status} — ensure Meta Box fields are exposed via show_in_rest`,
      { status: res.status, post_id: input.post_id },
    );
  }

  await recordChange(target, {
    category: "post",
    subcategory: `metabox_meta:${input.post_id}`,
    targetDescriptor: `meta-box meta update post #${input.post_id}`,
    beforeState: { post_id: input.post_id, meta: beforeMeta },
    afterState: { post_id: input.post_id, meta: input.meta },
    reversible: true,
    sourceTool: "wp_metabox_write",
  });

  return {
    ok: true,
    post_id: input.post_id,
    written: Object.keys(input.meta).length,
  };
}
