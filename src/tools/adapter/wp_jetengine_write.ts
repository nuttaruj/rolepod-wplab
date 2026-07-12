import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { verifyRestMeta } from "../../adapters/_shared/verifyRestMeta.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const JetEngineWriteInputSchema = z.object({
  target_id: z.string(),
  scope: z.literal("post_meta"),
  post_id: z.number().int().positive(),
  meta: z.record(z.string(), z.unknown()),
});

export const wpJetengineWriteToolDef = {
  name: "rolepod_wp_jetengine_write",
  description:
    "Write JetEngine post meta on a connected target (scope=post_meta) — pass { post_id, meta: {key: value, ...} }. Writes via the core /wp/v2/posts meta endpoint. READ-BACK VERIFIED: it re-reads after writing and returns verified=false + unverified_fields when a value did not persist — a JetEngine field with non-standard storage accepts the write with 200 without changing (set those in the JetEngine UI). Field-group / CCT creation is plugin-internal — use the JetEngine admin UI or wp-cli. Auto-ledgered (reversible only when verified).",
  inputSchema: JetEngineWriteInputSchema,
};

export async function wpJetengineWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<unknown> {
  const input = JetEngineWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  // Read prior meta for ledger before-state.
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
      "JETENGINE_WRITE_FAILED",
      `REST returned HTTP ${res.status} — ensure JetEngine fields are register_meta'd or use show_in_rest=true`,
      { status: res.status, post_id: input.post_id },
    );
  }

  const check = await verifyRestMeta(target, input.post_id, input.meta);

  await recordChange(target, {
    category: "post",
    subcategory: `jetengine_meta:${input.post_id}`,
    targetDescriptor: `jetengine meta update post #${input.post_id}`,
    beforeState: { post_id: input.post_id, meta: beforeMeta },
    afterState: { post_id: input.post_id, meta: input.meta },
    reversible: check.verified,
    ...(check.note ? { notes: check.note } : {}),
    sourceTool: "wp_jetengine_write",
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
