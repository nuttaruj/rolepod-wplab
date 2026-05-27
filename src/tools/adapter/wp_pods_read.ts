import { z } from "zod";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const PodsReadInputSchema = z.object({
  target_id: z.string(),
  scope: z.enum(["pods", "fields_in_pod", "post_meta"]),
  pod_name: z.string().optional(),
  post_id: z.number().int().positive().optional(),
});

export const wpPodsReadToolDef = {
  name: "rolepod_wp_pods_read",
  description:
    "Read Pods Framework data on a connected target. Scopes: pods (list registered Pods — Custom Post Types, Taxonomies, Custom Tables), fields_in_pod (requires pod_name), post_meta (requires post_id; returns Pods fields via core meta API). Compatible with Pods free + Pro.",
  inputSchema: PodsReadInputSchema,
};

export async function wpPodsReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = PodsReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const plugins = await target.rest({
    method: "GET",
    path: "/wp/v2/plugins?search=pods",
  });
  const detected = Array.isArray(plugins.body)
    ? (plugins.body as Array<{ plugin?: string; status?: string }>).some(
        (p) => (p.plugin ?? "").includes("pods/") && p.status === "active",
      )
    : false;

  if (!detected) {
    return { scope: input.scope, detected: false, items: [] };
  }

  switch (input.scope) {
    case "pods": {
      // Pods registers `_pods_pod` post type for pod definitions.
      const r = await target.rest({
        method: "GET",
        path: "/wp/v2/posts?type=_pods_pod&per_page=100",
      });
      return { scope: input.scope, detected: true, pods: r.body };
    }
    case "fields_in_pod": {
      if (input.pod_name === undefined) {
        return {
          scope: input.scope,
          detected: true,
          error: "pod_name required",
        };
      }
      // Pods stores fields under `_pods_field` post type with parent = pod ID.
      const r = await target.rest({
        method: "GET",
        path: `/wp/v2/posts?type=_pods_field&search=${encodeURIComponent(input.pod_name)}&per_page=100`,
      });
      return { scope: input.scope, detected: true, fields: r.body };
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
