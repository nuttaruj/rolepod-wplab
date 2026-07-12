import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { phpJsonArg } from "../../lib/phpEmbed.js";
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
  // Social/OpenGraph + Twitter cards (WS5-T3, additive). Mapped to the plugin's
  // own documented postmeta keys.
  og_title: z.string().optional(),
  og_description: z.string().optional(),
  og_image: z.string().url().optional(),
  twitter_title: z.string().optional(),
  twitter_description: z.string().optional(),
  twitter_image: z.string().url().optional(),
});

export const wpSeoSetToolDef = {
  name: "rolepod_wp_seo_set",
  description:
    "Set SEO post meta (focus keyword / meta description / title / canonical / noindex) — auto-detects Yoast or RankMath and writes the right meta keys. For Yoast it ALSO deletes the post's wp_yoast_indexable row so the cached indexable rebuilds (writing postmeta alone leaves the front end serving stale SEO — the G7 silent-no-op bug). Verifies for real by fetching the rendered page and checking the description is in the <head> (desc_in_head), not by echoing back the meta just written. Companion + execute-php only, so it is production-blocked: on a prod target use the plugin UI. Refuses if neither plugin is active. Auto-ledgered.",
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
  ? ['focus_keyword' => '_yoast_wpseo_focuskw', 'meta_description' => '_yoast_wpseo_metadesc', 'meta_title' => '_yoast_wpseo_title', 'canonical' => '_yoast_wpseo_canonical', 'noindex' => '_yoast_wpseo_meta-robots-noindex', 'og_title' => '_yoast_wpseo_opengraph-title', 'og_description' => '_yoast_wpseo_opengraph-description', 'og_image' => '_yoast_wpseo_opengraph-image', 'twitter_title' => '_yoast_wpseo_twitter-title', 'twitter_description' => '_yoast_wpseo_twitter-description', 'twitter_image' => '_yoast_wpseo_twitter-image']
  : ['focus_keyword' => 'rank_math_focus_keyword', 'meta_description' => 'rank_math_description', 'meta_title' => 'rank_math_title', 'canonical' => 'rank_math_canonical_url', 'noindex' => 'rank_math_robots', 'og_title' => 'rank_math_facebook_title', 'og_description' => 'rank_math_facebook_description', 'og_image' => 'rank_math_facebook_image', 'twitter_title' => 'rank_math_twitter_title', 'twitter_description' => 'rank_math_twitter_description', 'twitter_image' => 'rank_math_twitter_image'];
$input = ${phpJsonArg(input)};
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
// G7 fix: Yoast caches SEO meta in its own wp_yoast_indexable table. Writing
// postmeta alone leaves the front end serving the STALE indexable — a silent
// no-op. Delete this post's indexable row so Yoast rebuilds it on next load.
global $wpdb;
$indexable_rebuilt = false;
if ($yoast) {
  $t = $wpdb->prefix . 'yoast_indexable';
  if ($wpdb->get_var($wpdb->prepare('SHOW TABLES LIKE %s', $t)) === $t) {
    $wpdb->delete($t, ['object_id' => ${input.post_id}, 'object_type' => 'post']);
    $indexable_rebuilt = true;
  }
}
// Real verify: fetch the rendered page and confirm the description is actually
// in the <head>, instead of echoing back the postmeta we just wrote (which
// proves nothing about what visitors/search engines see).
$desc_in_head = null;
$status = get_post_status(${input.post_id});
if ($status === 'publish' && isset($input['meta_description'])) {
  $resp = wp_remote_get(get_permalink(${input.post_id}), ['timeout' => 8, 'sslverify' => false]);
  if (!is_wp_error($resp)) {
    $head = (string) wp_remote_retrieve_body($resp);
    $needle = (string) $input['meta_description'];
    $desc_in_head = ($needle !== '' && strpos($head, $needle) !== false);
  }
}
return ['plugin' => $plugin, 'post_id' => ${input.post_id}, 'set' => $set, 'before' => $before, 'indexable_rebuilt' => $indexable_rebuilt, 'desc_in_head' => $desc_in_head, 'post_status' => $status];`;

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
    indexable_rebuilt?: boolean;
    desc_in_head?: boolean | null;
    post_status?: string;
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
