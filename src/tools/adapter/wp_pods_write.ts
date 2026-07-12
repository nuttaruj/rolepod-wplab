import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { verifyRestMeta } from "../../adapters/_shared/verifyRestMeta.js";
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
    "Write Pods Framework post meta on a connected target (scope=post_meta) — pass { post_id, meta: {field_id: value, ...} }. Writes via the core /wp/v2/posts meta endpoint, so the field must be REST-exposed (Pods Pro auto-exposes; free may need show_in_rest=true). READ-BACK VERIFIED: after writing, it re-reads the meta and returns verified=false + an unverified_fields list if a value did not persist — a Pods field stored in a CUSTOM TABLE accepts the write with HTTP 200 but does not change (set those in the Pods UI). Auto-ledgered (reversible only when verified).",
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

  // Read-back verify — a Pods field stored in a custom table accepts the core
  // REST meta write with 200 but does not actually change. Catch that no-op.
  const check = await verifyRestMeta(target, input.post_id, input.meta);

  await recordChange(target, {
    category: "post",
    subcategory: `pods_meta:${input.post_id}`,
    targetDescriptor: `pods meta update post #${input.post_id}`,
    beforeState: { post_id: input.post_id, meta: beforeMeta },
    afterState: { post_id: input.post_id, meta: input.meta },
    // Only claim reversibility when the write actually landed.
    reversible: check.verified,
    ...(check.note ? { notes: check.note } : {}),
    sourceTool: "wp_pods_write",
  });

  return {
    ok: check.verified,
    post_id: input.post_id,
    written: Object.keys(input.meta).length,
    verified: check.verified,
    ...(check.mismatched.length ? { unverified_fields: check.mismatched } : {}),
    ...(check.note ? { note: check.note } : {}),
  };
}
