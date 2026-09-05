import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { CompanionRequiredError, WplabError } from "../../util/errors.js";
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
    throw new CompanionRequiredError("wp_set_front_page", input.target_id);
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
    previous?: {
      show_on_front?: unknown;
      page_on_front?: unknown;
      page_for_posts?: unknown;
    };
  };

  // One ledger row per option, keyed by the real option name — the companion's
  // `option` dispatcher restores by option name + beforeState.value, so a single
  // row keyed "front-page" would look for an option that does not exist and
  // revert nothing. `page_for_posts` is only recorded when we changed it.
  const prev = rv.previous ?? {};
  const rows: Array<{ name: string; before: unknown; after: unknown }> = [
    {
      name: "show_on_front",
      before: prev.show_on_front,
      after: rv.show_on_front,
    },
    {
      name: "page_on_front",
      before: prev.page_on_front,
      after: rv.page_on_front,
    },
  ];
  if (input.posts_page_id !== undefined) {
    rows.push({
      name: "page_for_posts",
      before: prev.page_for_posts,
      after: rv.page_for_posts,
    });
  }

  for (const row of rows) {
    await recordChange(target, {
      category: "option",
      subcategory: row.name,
      targetDescriptor: `option ${row.name} (via wp_set_front_page)`,
      beforeState: { value: row.before },
      afterState: { value: row.after },
      reversible: true,
      sourceTool: "wp_set_front_page",
    });
  }
  return rv;
}
