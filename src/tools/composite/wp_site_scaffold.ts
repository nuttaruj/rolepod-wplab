import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { phpJsonArg } from "../../lib/phpEmbed.js";
import { CompanionRequiredError, WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const SiteScaffoldInputSchema = z.object({
  target_id: z.string(),
  identity: z
    .object({
      title: z.string().optional(),
      tagline: z.string().optional(),
      timezone: z.string().optional(),
      permalink_structure: z.string().optional(),
    })
    .optional(),
  pages: z
    .array(
      z.object({
        slug: z.string(),
        title: z.string(),
        content: z.string(),
        status: z.enum(["publish", "draft"]).default("publish"),
      }),
    )
    .optional(),
  menu: z
    .object({
      name: z.string().default("Primary"),
      location: z.string().default("primary"),
      items: z
        .array(
          z.object({
            page_slug: z.string(),
            title: z.string(),
          }),
        )
        .default([]),
    })
    .optional(),
  front_page_slug: z.string().optional(),
  blog_page_slug: z.string().optional(),
});

export const wpSiteScaffoldToolDef = {
  name: "rolepod_wp_site_scaffold",
  description:
    "One-shot site scaffold from a JSON spec. Orchestrates option_set (identity), page_create (pages by slug), menu_create + menu_add_item + menu_assign, set_front_page. Returns a manifest mapping slug → id for follow-up calls (products, CF7 forms, theme styles, etc.). All operations auto-ledgered.",
  inputSchema: SiteScaffoldInputSchema,
};

export async function wpSiteScaffoldHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = SiteScaffoldInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new CompanionRequiredError("wp_site_scaffold", input.target_id);
  }
  const bridge = await bridgeFor(target);

  // One mega-payload runs server-side so the entire scaffold is atomic-ish
  // and avoids 10+ round-trips. We pass all input data as a single
  // JSON-encoded PHP string + json_decode at the top, because JSON object
  // syntax `{"a":1}` is NOT valid PHP. v1.10.0 first cut tried to embed
  // JSON.stringify(input.x) raw into PHP source which parse-errored on
  // any object with `{`. Fixed: stringify-then-jsondecode pattern.
  const inputObj = {
    identity: input.identity ?? {},
    pages: input.pages ?? [],
    menu: input.menu ?? null,
    front_page_slug: input.front_page_slug ?? null,
    blog_page_slug: input.blog_page_slug ?? null,
  };
  const payload = `$input = ${phpJsonArg(inputObj)};
$result = ['identity' => [], 'pages' => [], 'menu' => null, 'front_page' => null];
$identity = (array) ($input['identity'] ?? []);
foreach ($identity as $key => $val) {
  $map = ['title' => 'blogname', 'tagline' => 'blogdescription', 'timezone' => 'timezone_string', 'permalink_structure' => 'permalink_structure'];
  $opt = $map[$key] ?? $key;
  update_option($opt, $val);
  $result['identity'][$opt] = $val;
}
$pages = (array) ($input['pages'] ?? []);
$page_id_by_slug = [];
foreach ($pages as $page) {
  $existing = get_page_by_path($page['slug']);
  if ($existing && $existing->post_type === 'page') {
    wp_update_post(['ID' => $existing->ID, 'post_title' => $page['title'], 'post_content' => $page['content'], 'post_status' => $page['status'] ?? 'publish']);
    $page_id_by_slug[$page['slug']] = (int) $existing->ID;
    $result['pages'][] = ['slug' => $page['slug'], 'id' => (int) $existing->ID, 'action' => 'updated'];
  } else {
    $new_id = wp_insert_post(['post_type' => 'page', 'post_title' => $page['title'], 'post_content' => $page['content'], 'post_status' => $page['status'] ?? 'publish', 'post_name' => $page['slug']]);
    if (is_wp_error($new_id)) {
      $result['pages'][] = ['slug' => $page['slug'], 'error' => $new_id->get_error_message()];
      continue;
    }
    $page_id_by_slug[$page['slug']] = (int) $new_id;
    $result['pages'][] = ['slug' => $page['slug'], 'id' => (int) $new_id, 'action' => 'created'];
  }
}
$menu = $input['menu'] ?? null;
if ($menu) {
  $existing_menu = wp_get_nav_menu_object($menu['name']);
  $menu_id = $existing_menu ? (int) $existing_menu->term_id : null;
  if (!$menu_id) {
    $created = wp_create_nav_menu($menu['name']);
    if (is_wp_error($created)) {
      $result['menu'] = ['error' => $created->get_error_message()];
      $menu_id = null;
    } else {
      $menu_id = (int) $created;
    }
  }
  if ($menu_id) {
    $items_added = [];
    foreach ((array) ($menu['items'] ?? []) as $item) {
      $pid = $page_id_by_slug[$item['page_slug']] ?? null;
      if (!$pid) continue;
      $item_id = wp_update_nav_menu_item($menu_id, 0, [
        'menu-item-title' => $item['title'],
        'menu-item-object' => 'page',
        'menu-item-object-id' => $pid,
        'menu-item-type' => 'post_type',
        'menu-item-status' => 'publish',
      ]);
      if (!is_wp_error($item_id)) $items_added[] = (int) $item_id;
    }
    $locations = (array) get_theme_mod('nav_menu_locations', []);
    $locations[$menu['location'] ?? 'primary'] = $menu_id;
    set_theme_mod('nav_menu_locations', $locations);
    $result['menu'] = ['menu_id' => $menu_id, 'name' => $menu['name'], 'location' => $menu['location'] ?? 'primary', 'items_added' => count($items_added)];
  }
}
$front_slug = $input['front_page_slug'] ?? null;
$blog_slug = $input['blog_page_slug'] ?? null;
if ($front_slug && isset($page_id_by_slug[$front_slug])) {
  update_option('show_on_front', 'page');
  update_option('page_on_front', $page_id_by_slug[$front_slug]);
  $result['front_page'] = ['slug' => $front_slug, 'id' => $page_id_by_slug[$front_slug]];
}
if ($blog_slug && isset($page_id_by_slug[$blog_slug])) {
  update_option('page_for_posts', $page_id_by_slug[$blog_slug]);
  $result['blog_page'] = ['slug' => $blog_slug, 'id' => $page_id_by_slug[$blog_slug]];
}
flush_rewrite_rules(false);
return $result;`;

  const result = await bridge.executePhp(payload, { timeoutMs: 20000 });
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "SITE_SCAFFOLD_FAILED",
      result.error_message ?? "wp_site_scaffold execute-php failed",
      { result },
    );
  }
  await recordChange(target, {
    category: "layout",
    subcategory: "site-scaffold",
    targetDescriptor: `site scaffold (${input.pages?.length ?? 0} pages, menu: ${input.menu ? "yes" : "no"})`,
    beforeState: null,
    afterState: result.return_value as Record<string, unknown> | null,
    reversible: false, // many ops; reverse individually via ledger
    sourceTool: "wp_site_scaffold",
  });
  return result.return_value;
}
