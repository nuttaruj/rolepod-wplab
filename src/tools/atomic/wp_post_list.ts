import {
  PostListInputSchema,
  PostListOutputSchema,
  type PostListInput,
  type PostListOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpPostListToolDef = {
  name: "rolepod_wp_post_list",
  description:
    "List posts (or any registered REST collection) with pagination + search + status filters via the WP REST API.",
  inputSchema: PostListInputSchema,
};

export async function wpPostListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<PostListOutput> {
  const input: PostListInput = PostListInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const query: Record<string, string | number | boolean> = {
    per_page: input.per_page,
    page: input.page,
  };
  if (input.search !== undefined) query["search"] = input.search;
  if (input.status !== undefined) query["status"] = input.status;
  if (input.orderby !== undefined) query["orderby"] = input.orderby;
  if (input.order !== undefined) query["order"] = input.order;

  const res = await target.rest({
    method: "GET",
    path: `/wp/v2/${input.type}`,
    query,
  });

  const total = numFromHeader(res.headers["x-wp-total"]);
  const totalPages = numFromHeader(res.headers["x-wp-totalpages"]);
  const items = Array.isArray(res.body) ? res.body : [];

  return PostListOutputSchema.parse({
    status: res.status,
    items,
    ...(total !== undefined ? { total } : {}),
    ...(totalPages !== undefined ? { total_pages: totalPages } : {}),
  });
}

function numFromHeader(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}
