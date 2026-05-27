import { z } from "zod";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const MetaBoxReadInputSchema = z.object({
  target_id: z.string(),
  scope: z.enum(["field_groups", "post_meta"]),
  post_id: z.number().int().positive().optional(),
});

export const wpMetaboxReadToolDef = {
  name: "rolepod_wp_metabox_read",
  description:
    "Read Meta Box (metabox.io) data. Scopes: field_groups (list registered RWMB groups via post_type rwmb_meta_box), post_meta (requires post_id; returns all Meta Box fields via core meta API). Compatible with Meta Box free + AIO bundle.",
  inputSchema: MetaBoxReadInputSchema,
};

export async function wpMetaboxReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = MetaBoxReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const plugins = await target.rest({
    method: "GET",
    path: "/wp/v2/plugins?search=meta-box",
  });
  const detected = Array.isArray(plugins.body)
    ? (plugins.body as Array<{ plugin?: string; status?: string }>).some(
        (p) =>
          (p.plugin ?? "").includes("meta-box") && p.status === "active",
      )
    : false;

  if (!detected) {
    return { scope: input.scope, detected: false, items: [] };
  }

  switch (input.scope) {
    case "field_groups": {
      const r = await target.rest({
        method: "GET",
        path: "/wp/v2/posts?type=rwmb_meta_box&per_page=100",
      });
      return { scope: input.scope, detected: true, groups: r.body };
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
      return { scope: input.scope, detected: true, meta };
    }
  }
}
