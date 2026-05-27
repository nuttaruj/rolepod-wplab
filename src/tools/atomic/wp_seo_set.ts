import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const SeoSetInputSchema = z.object({
  target_id: z.string(),
  post_id: z.number().int().positive(),
  focus_keyword: z.string().optional(),
  meta_description: z.string().optional(),
  meta_title: z.string().optional(),
  canonical: z.string().url().optional(),
  noindex: z.boolean().optional(),
});

export const wpSeoSetToolDef = {
  name: "rolepod_wp_seo_set",
  description:
    "Set SEO post meta (focus keyword / meta description / title / canonical / noindex) — auto-detects Yoast or RankMath and writes the right meta keys. Refuses if neither plugin is active. Auto-ledgered.",
  inputSchema: SeoSetInputSchema,
};

export async function wpSeoSetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = SeoSetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_seo_set requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);

  // Detect which SEO plugin is active and map fields accordingly. Yoast uses
  // `_yoast_wpseo_*` keys, RankMath uses `rank_math_*`.
  const payload = `$active = (array) get_option('active_plugins', []);
$yoast = in_array('wordpress-seo/wp-seo.php', $active, true);
$rank = in_array('seo-by-rank-math/rank-math.php', $active, true);
if (!$yoast && !$rank) return ['error' => 'NO_SEO_PLUGIN', 'detail' => 'Install Yoast SEO or Rank Math first.'];
$plugin = $yoast ? 'yoast' : 'rankmath';
$before = [];
$set = [];
$mappings = $yoast
  ? ['focus_keyword' => '_yoast_wpseo_focuskw', 'meta_description' => '_yoast_wpseo_metadesc', 'meta_title' => '_yoast_wpseo_title', 'canonical' => '_yoast_wpseo_canonical', 'noindex' => '_yoast_wpseo_meta-robots-noindex']
  : ['focus_keyword' => 'rank_math_focus_keyword', 'meta_description' => 'rank_math_description', 'meta_title' => 'rank_math_title', 'canonical' => 'rank_math_canonical_url', 'noindex' => 'rank_math_robots'];
$input = json_decode(${JSON.stringify(JSON.stringify(input))}, true);
foreach ($mappings as $field => $key) {
  if (array_key_exists($field, $input)) {
    $before[$key] = get_post_meta(${input.post_id}, $key, true);
    if ($field === 'noindex' && $rank) {
      $val = $input[$field] ? ['noindex'] : [];
    } elseif ($field === 'noindex' && $yoast) {
      $val = $input[$field] ? '1' : '2';
    } else {
      $val = $input[$field];
    }
    update_post_meta(${input.post_id}, $key, $val);
    $set[$key] = $val;
  }
}
return ['plugin' => $plugin, 'post_id' => ${input.post_id}, 'set' => $set, 'before' => $before];`;

  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "SEO_SET_FAILED",
      result.error_message ?? "wp_seo_set execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    plugin?: string;
    post_id?: number;
    set?: Record<string, unknown>;
    before?: Record<string, unknown>;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, {});
  }
  await recordChange(target, {
    category: "post",
    subcategory: `seo:${rv.plugin}:${input.post_id}`,
    targetDescriptor: `${rv.plugin} SEO meta updated on post ${input.post_id}`,
    beforeState: rv.before ?? null,
    afterState: rv.set ?? null,
    reversible: true,
    sourceTool: "wp_seo_set",
  });
  return rv;
}
