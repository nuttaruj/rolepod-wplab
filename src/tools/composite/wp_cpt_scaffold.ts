import { ProdGuard } from "../../safety/ProdGuard.js";
import { phpLiteral, phpQuote } from "../../lib/phpEmbed.js";
import {
  CptScaffoldInputSchema,
  CptScaffoldOutputSchema,
  type CptScaffoldInput,
  type CptScaffoldOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCptScaffoldToolDef = {
  name: "rolepod_wp_cpt_scaffold",
  description:
    "Register a custom post type by scaffolding a small regular plugin under wp-content/plugins/ (NOT mu-plugins) that calls register_post_type on init and flushes rewrite rules on activation, then activating it. Idempotent-ish: re-running for an already-scaffolded slug returns CPT_ALREADY_EXISTS. Verifies the CPT is live by fetching its REST collection. Production writes need confirm=true.",
  inputSchema: CptScaffoldInputSchema,
};

const DEFAULT_SUPPORTS = ["title", "editor", "thumbnail"];

function pluginSlug(slug: string): string {
  return `rolepod-cpt-${slug}`;
}

function pluginDir(slug: string): string {
  return `wp-content/plugins/${pluginSlug(slug)}`;
}

function pluginFile(slug: string): string {
  return `${pluginDir(slug)}/${pluginSlug(slug)}.php`;
}

/** Build the plugin PHP. Every user string is embedded via phpQuote — a crafted
 *  label can never break out of its literal into executable code. */
function buildPluginPhp(input: CptScaffoldInput): string {
  const supports = input.supports?.length ? input.supports : DEFAULT_SUPPORTS;
  const supportsPhp = "[" + supports.map((s) => phpQuote(s)).join(", ") + "]";
  const fn = `rolepod_cpt_${input.slug.replace(/-/g, "_")}`;
  return `<?php
/**
 * Plugin Name: Rolepod CPT — ${input.plural.replace(/\*\//g, "* /")}
 * Description: Registers the "${input.slug.replace(/\*\//g, "* /")}" custom post type. Scaffolded by rolepod-wplab.
 * Version: 1.0.0
 */

if (!defined('ABSPATH')) { exit; }

add_action('init', '${fn}_register');
function ${fn}_register() {
	register_post_type(${phpQuote(input.slug)}, [
		'labels' => [
			'name' => ${phpQuote(input.plural)},
			'singular_name' => ${phpQuote(input.singular)},
			'menu_name' => ${phpQuote(input.plural)},
			'add_new_item' => ${phpQuote("Add New " + input.singular)},
			'edit_item' => ${phpQuote("Edit " + input.singular)},
		],
		'public' => ${phpLiteral(input.public)},
		'show_in_rest' => ${phpLiteral(input.show_in_rest)},
		'has_archive' => ${phpLiteral(input.has_archive)},
		'supports' => ${supportsPhp},
	]);
}

register_activation_hook(__FILE__, '${fn}_activate');
function ${fn}_activate() {
	${fn}_register();
	flush_rewrite_rules();
}

register_deactivation_hook(__FILE__, function () { flush_rewrite_rules(); });
`;
}

export async function wpCptScaffoldHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<CptScaffoldOutput> {
  const input: CptScaffoldInput = CptScaffoldInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "cpt_scaffold blocked on production-matched target — pass confirm=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  const file = pluginFile(input.slug);

  // Idempotency: if the scaffold already exists, do not silently overwrite.
  let exists = false;
  try {
    await target.fileRead(file);
    exists = true;
  } catch {
    exists = false;
  }
  if (exists) {
    throw new WplabError(
      "CPT_ALREADY_EXISTS",
      `a scaffold for "${input.slug}" already exists at ${file} — edit it directly or delete it first`,
      { slug: input.slug, plugin_file: file },
    );
  }

  await target.fileWrite(file, buildPluginPhp(input), { backup: false });

  // Activate — plugin activate is allowlisted; runs the activation flush.
  const act = await target.wpCli(
    ["plugin", "activate", pluginSlug(input.slug)],
    {
      allowDestructive: true,
    },
  );
  const activated = act.exitCode === 0;

  // Verify the CPT is live over REST (rest_base defaults to the post-type key).
  const restBase = input.slug;
  let restVerified = false;
  try {
    const res = await target.rest({
      method: "GET",
      path: `/wp/v2/${restBase}`,
      query: { per_page: 1 },
    });
    restVerified = res.status >= 200 && res.status < 300;
  } catch {
    restVerified = false;
  }

  return CptScaffoldOutputSchema.parse({
    slug: input.slug,
    plugin_file: file,
    activated,
    rest_verified: restVerified,
    rest_base: restBase,
  });
}
