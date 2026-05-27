import { z } from "zod";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const JetEngineReadInputSchema = z.object({
  target_id: z.string(),
  scope: z.enum(["field_groups", "post_meta", "cct_list"]),
  post_id: z.number().int().positive().optional(),
});

export const wpJetengineReadToolDef = {
  name: "rolepod_wp_jetengine_read",
  description:
    "Read JetEngine data on a connected target. Scopes: field_groups (lists Meta Boxes registered via JetEngine), post_meta (requires post_id; returns all JetEngine fields for a post), cct_list (Custom Content Types registered).",
  inputSchema: JetEngineReadInputSchema,
};

export async function wpJetengineReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = JetEngineReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const plugins = await target.rest({
    method: "GET",
    path: "/wp/v2/plugins?search=jet-engine",
  });
  const detected = Array.isArray(plugins.body)
    ? (plugins.body as Array<{ plugin?: string; status?: string }>).some(
        (p) =>
          (p.plugin ?? "").includes("jet-engine") && p.status === "active",
      )
    : false;

  if (!detected) {
    return { scope: input.scope, detected: false, items: [] };
  }

  switch (input.scope) {
    case "field_groups": {
      const r = await target.rest({
        method: "GET",
        path: "/wp/v2/types/jet-cct",
      });
      return { scope: input.scope, detected: true, raw: r.body };
    }
    case "cct_list": {
      const r = await target.rest({
        method: "GET",
        path: "/wp/v2/types?context=view",
      });
      const types = (r.body ?? {}) as Record<string, unknown>;
      const cct = Object.keys(types).filter(
        (k) => k.startsWith("jet-") || k.startsWith("cct_"),
      );
      return { scope: input.scope, detected: true, content_types: cct };
    }
    case "post_meta": {
      if (input.post_id === undefined) {
        return {
          scope: input.scope,
          detected: true,
          error: "post_id required",
        };
      }
      const r = await target.rest({
        method: "GET",
        path: `/wp/v2/posts/${input.post_id}?context=edit`,
      });
      const meta = ((r.body ?? {}) as Record<string, unknown>)["meta"] ?? {};
      // JetEngine convention: meta keys start with underscore or are user-named.
      return { scope: input.scope, detected: true, meta };
    }
  }
}
