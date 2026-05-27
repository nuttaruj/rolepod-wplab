import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const SetFrontPageInputSchema = z.object({
  target_id: z.string(),
  front_page_id: z
    .number()
    .int()
    .positive()
    .describe("Post id of the page to use as the static front page."),
  posts_page_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional — page id where the blog index should appear (page_for_posts). Omit to leave unchanged.",
    ),
});

export const wpSetFrontPageToolDef = {
  name: "rolepod_wp_set_front_page",
  description:
    "Configure WordPress to show a static page as the front page. Sets show_on_front=page + page_on_front. Optionally also sets page_for_posts (blog index location). Auto-ledgered.",
  inputSchema: SetFrontPageInputSchema,
};

export async function wpSetFrontPageHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = SetFrontPageInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_set_front_page requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);
  const payload = `$prev_show = get_option('show_on_front');
$prev_front = (int) get_option('page_on_front');
$prev_posts = (int) get_option('page_for_posts');
update_option('show_on_front', 'page');
update_option('page_on_front', ${input.front_page_id});
${input.posts_page_id !== undefined ? `update_option('page_for_posts', ${input.posts_page_id});` : ""}
return [
  'show_on_front' => get_option('show_on_front'),
  'page_on_front' => (int) get_option('page_on_front'),
  'page_for_posts' => (int) get_option('page_for_posts'),
  'previous' => ['show_on_front' => $prev_show, 'page_on_front' => $prev_front, 'page_for_posts' => $prev_posts],
];`;
  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "SET_FRONT_PAGE_FAILED",
      result.error_message ?? "wp_set_front_page execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    show_on_front?: string;
    page_on_front?: number;
    page_for_posts?: number;
    previous?: Record<string, unknown>;
  };
  await recordChange(target, {
    category: "option",
    subcategory: "front-page",
    targetDescriptor: `front page → page ${input.front_page_id}${input.posts_page_id ? `, blog → page ${input.posts_page_id}` : ""}`,
    beforeState: rv.previous ?? null,
    afterState: {
      show_on_front: rv.show_on_front,
      page_on_front: rv.page_on_front,
      page_for_posts: rv.page_for_posts,
    },
    reversible: true,
    sourceTool: "wp_set_front_page",
  });
  return rv;
}
