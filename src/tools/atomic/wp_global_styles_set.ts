import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { phpQuote } from "../../lib/phpEmbed.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

const ColorEntrySchema = z.object({
  slug: z.string(),
  name: z.string().optional(),
  color: z.string().describe("CSS color value, typically a hex (#aabbcc)."),
});

const TypographyEntrySchema = z.object({
  slug: z.string(),
  name: z.string().optional(),
  fontFamily: z.string(),
});

export const GlobalStylesSetInputSchema = z.object({
  target_id: z.string(),
  palette: z.array(ColorEntrySchema).optional(),
  font_families: z.array(TypographyEntrySchema).optional(),
  styles: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Free-form 'styles' branch of theme.json (color, typography, elements, spacing, etc.). Merged with palette/font_families.",
    ),
});

export const wpGlobalStylesSetToolDef = {
  name: "rolepod_wp_global_styles_set",
  description:
    "Write the active block theme's user-level Global Styles (the wp_global_styles CPT row Site Editor manages). Adds color palette + font families + custom styles. Replaces existing user styles wholesale for the active theme. Auto-ledgered.",
  inputSchema: GlobalStylesSetInputSchema,
};

export async function wpGlobalStylesSetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = GlobalStylesSetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_global_styles_set requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);

  const stylesJson: Record<string, unknown> = {
    version: 2,
    isGlobalStylesUserThemeJSON: true,
    settings: {
      color: {
        palette: input.palette ?? [],
      },
      typography: {
        fontFamilies: input.font_families ?? [],
      },
    },
    ...(input.styles ? { styles: input.styles } : {}),
  };

  const stylesEncoded = JSON.stringify(stylesJson);

  const payload = `$stylesheet = get_stylesheet();
$existing = get_posts([
  'post_type' => 'wp_global_styles',
  'tax_query' => [['taxonomy' => 'wp_theme', 'field' => 'slug', 'terms' => $stylesheet]],
  'posts_per_page' => 1,
  'post_status' => 'any',
]);
$post_id = $existing ? (int) $existing[0]->ID : null;
$styles_json = ${phpQuote(stylesEncoded)};
if ($post_id) {
  $prev = get_post($post_id);
  $prev_content = $prev ? $prev->post_content : null;
  wp_update_post(['ID' => $post_id, 'post_content' => $styles_json]);
  return ['action' => 'updated', 'post_id' => $post_id, 'theme' => $stylesheet, 'previous_content' => $prev_content];
}
$new_id = wp_insert_post([
  'post_title' => 'Custom Styles',
  'post_status' => 'publish',
  'post_type' => 'wp_global_styles',
  'post_content' => $styles_json,
]);
if (is_wp_error($new_id)) return ['error' => 'INSERT_FAILED', 'detail' => $new_id->get_error_message()];
wp_set_object_terms($new_id, $stylesheet, 'wp_theme');
return ['action' => 'created', 'post_id' => (int) $new_id, 'theme' => $stylesheet];`;

  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "GLOBAL_STYLES_SET_FAILED",
      result.error_message ?? "wp_global_styles_set execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    action?: string;
    post_id?: number;
    theme?: string;
    previous_content?: string | null;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, {});
  }
  await recordChange(target, {
    category: "theme",
    subcategory: `global-styles:${rv.theme}`,
    targetDescriptor: `global styles ${rv.action} for theme ${rv.theme}`,
    beforeState: rv.previous_content ? { content: rv.previous_content } : null,
    afterState: { content_preview: stylesEncoded.slice(0, 200) },
    reversible: rv.action === "updated", // can re-set previous content
    sourceTool: "wp_global_styles_set",
  });
  return rv;
}
