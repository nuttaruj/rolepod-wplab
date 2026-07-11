import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  PostUpdateInputSchema,
  PostUpdateOutputSchema,
  type PostUpdateInput,
  type PostUpdateOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpPostUpdateToolDef = {
  name: "rolepod_wp_post_update",
  description:
    "Update an existing post (or any registered REST collection entry) by ID via the WP REST API. Only specified fields are sent.",
  inputSchema: PostUpdateInputSchema,
};

export async function wpPostUpdateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<PostUpdateOutput> {
  const input: PostUpdateInput = PostUpdateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body["title"] = input.title;
  if (input.content !== undefined) body["content"] = input.content;
  if (input.status !== undefined) body["status"] = input.status;
  if (input.meta !== undefined) body["meta"] = input.meta;
  if (input.categories !== undefined) body["categories"] = input.categories;
  if (input.tags !== undefined) body["tags"] = input.tags;

  if (Object.keys(body).length === 0) {
    throw new WplabError(
      "POST_UPDATE_NO_FIELDS",
      "post_update requires at least one of: title, content, status, meta, categories, tags",
      { id: input.id },
    );
  }

  // Snapshot before-state for the ledger. Best-effort — if the read fails
  // (deleted between read + write, perms drop), we still proceed with the
  // write and skip the ledger record.
  let beforeState: Record<string, unknown> | null = null;
  try {
    const pre = await target.rest({
      method: "GET",
      path: `/wp/v2/${input.type}/${input.id}?context=edit`,
    });
    if (pre.status >= 200 && pre.status < 300) {
      const pb = (pre.body ?? {}) as Record<string, unknown>;
      beforeState = {
        post_id: input.id,
        post_title: (pb["title"] as { raw?: string })?.raw ?? "",
        post_content: (pb["content"] as { raw?: string })?.raw ?? "",
        post_status: pb["status"] ?? null,
      };
    }
  } catch {
    /* swallow */
  }

  const res = await target.rest({
    method: "POST", // WP REST treats POST to existing /posts/{id} as update
    path: `/wp/v2/${input.type}/${input.id}`,
    body,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "POST_UPDATE_FAILED",
      `REST returned HTTP ${res.status}`,
      {
        status: res.status,
        body: res.body,
      },
    );
  }

  const b = (res.body ?? {}) as { id?: number; modified?: string };

  // Ledger record — non-fatal on failure.
  if (beforeState !== null) {
    await recordChange(target, {
      category: "post",
      subcategory: input.type,
      targetDescriptor: `update ${input.type} #${input.id}`,
      beforeState,
      afterState: {
        post_id: input.id,
        ...body,
      },
      reversible: true,
      sourceTool: "wp_post_update",
    });
  }

  return PostUpdateOutputSchema.parse({
    status: res.status,
    id: b.id ?? input.id,
    ...(b.modified !== undefined ? { modified: b.modified } : {}),
  });
}
