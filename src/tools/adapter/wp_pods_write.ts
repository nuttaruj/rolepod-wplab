import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const PodsWriteInputSchema = z.object({
  target_id: z.string(),
  scope: z.literal("post_meta"),
  post_id: z.number().int().positive(),
  meta: z.record(z.string(), z.unknown()),
});

export const wpPodsWriteToolDef = {
  name: "rolepod_wp_pods_write",
  description:
    "Write Pods Framework post meta on a connected target. v1.8 supports scope=post_meta only — pass { post_id, meta: {field_id: value, ...} }. Pods fields must be REST-exposed (Pods Pro auto-exposes; free version may need show_in_rest=true on the field definition). Auto-ledgered.",
  inputSchema: PodsWriteInputSchema,
};

export async function wpPodsWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<unknown> {
  const input = PodsWriteInputSchema.parse(raw);
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
      "PODS_WRITE_FAILED",
      `REST returned HTTP ${res.status} — ensure Pods field has show_in_rest=true OR write via Pods PHP API`,
      { status: res.status, post_id: input.post_id },
    );
  }

  await recordChange(target, {
    category: "post",
    subcategory: `pods_meta:${input.post_id}`,
    targetDescriptor: `pods meta update post #${input.post_id}`,
    beforeState: { post_id: input.post_id, meta: beforeMeta },
    afterState: { post_id: input.post_id, meta: input.meta },
    reversible: true,
    sourceTool: "wp_pods_write",
  });

  return { ok: true, post_id: input.post_id, written: Object.keys(input.meta).length };
}
