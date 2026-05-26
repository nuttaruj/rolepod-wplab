import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  PostCreateInputSchema,
  PostCreateOutputSchema,
  type PostCreateInput,
  type PostCreateOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpPostCreateToolDef = {
  name: "rolepod_wp_post_create",
  description:
    "Create a new post (or any registered REST collection entry) via the WP REST API. Defaults to status=draft.",
  inputSchema: PostCreateInputSchema,
};

export async function wpPostCreateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<PostCreateOutput> {
  const input: PostCreateInput = PostCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const body: Record<string, unknown> = {
    title: input.title,
    content: input.content,
    status: input.status,
  };
  if (input.excerpt !== undefined) body["excerpt"] = input.excerpt;
  if (input.meta !== undefined) body["meta"] = input.meta;

  const res = await target.rest({
    method: "POST",
    path: `/wp/v2/${input.type}`,
    body,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "POST_CREATE_FAILED",
      `REST returned HTTP ${res.status}`,
      {
        status: res.status,
        body: res.body,
      },
    );
  }

  const b = (res.body ?? {}) as { id?: number; link?: string };
  if (typeof b.id !== "number") {
    throw new WplabError("POST_CREATE_NO_ID", "REST response missing post id", {
      body: res.body,
    });
  }

  return PostCreateOutputSchema.parse({
    status: res.status,
    id: b.id,
    ...(b.link !== undefined ? { link: b.link } : {}),
  });
}
