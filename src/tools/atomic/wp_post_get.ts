import {
  PostGetInputSchema,
  PostGetOutputSchema,
  type PostGetInput,
  type PostGetOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpPostGetToolDef = {
  name: "rolepod_wp_post_get",
  description:
    "Read a single post (or any registered REST collection — pages, custom post types) by ID via the WP REST API.",
  inputSchema: PostGetInputSchema,
};

export async function wpPostGetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<PostGetOutput> {
  const input: PostGetInput = PostGetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const res = await target.rest({
    method: "GET",
    path: `/wp/v2/${input.type}/${input.id}`,
    query: { context: input.context },
  });
  return PostGetOutputSchema.parse({ status: res.status, post: res.body });
}
