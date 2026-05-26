import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  ScaffoldPluginInputSchema,
  ScaffoldPluginOutputSchema,
  type ScaffoldPluginInput,
  type ScaffoldPluginOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpScaffoldPluginToolDef = {
  name: "rolepod_wp_scaffold_plugin",
  description:
    "Bootstrap a new WordPress plugin skeleton (main PHP file with plugin header + readme.txt + uninstall.php) under wp-content/plugins/<slug>/. Optional features (rest_endpoint / admin_page / gutenberg_block / cli_command) add corresponding stub files. Requires allow_destructive=true. Production guard applies.",
  inputSchema: ScaffoldPluginInputSchema,
};

export async function wpScaffoldPluginHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<ScaffoldPluginOutput> {
  const input: ScaffoldPluginInput = ScaffoldPluginInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const runId = makeRunId();
  const dir = `wp-content/plugins/${input.slug}`;
  const written: string[] = [];

  // Main plugin file
  const main = `<?php
/**
 * Plugin Name: ${input.name}
 * Description: ${input.description ?? input.name}
 * Version: 0.1.0
 * Author: ${input.author}
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * License: GPL-2.0-or-later
 * Text Domain: ${input.slug}
 */

if (!defined('ABSPATH')) {
    exit;
}

define('${constName(input.slug)}_VERSION', '0.1.0');
define('${constName(input.slug)}_DIR', plugin_dir_path(__FILE__));
${input.features.includes("rest_endpoint") ? "require_once __DIR__ . '/inc/rest-endpoint.php';\n" : ""}${input.features.includes("admin_page") ? "require_once __DIR__ . '/inc/admin-page.php';\n" : ""}${input.features.includes("gutenberg_block") ? "add_action('init', function () { register_block_type(__DIR__ . '/blocks/example'); });\n" : ""}${input.features.includes("cli_command") ? "if (defined('WP_CLI') && WP_CLI) { require_once __DIR__ . '/inc/cli.php'; }\n" : ""}
`;
  await target.fileWrite(`${dir}/${input.slug}.php`, main, { backup: false });
  written.push(`${dir}/${input.slug}.php`);

  const readme = `=== ${input.name} ===
Contributors: ${input.author}
Tags: ai, automation
Requires at least: 6.0
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: 0.1.0
License: GPLv2 or later

${input.description ?? input.name}

== Description ==

Scaffolded by rolepod-wplab. Edit this readme + the main PHP file to add your plugin's behavior.
`;
  await target.fileWrite(`${dir}/readme.txt`, readme, { backup: false });
  written.push(`${dir}/readme.txt`);

  const uninstall = `<?php
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}
// Clean up any options the plugin created here.
`;
  await target.fileWrite(`${dir}/uninstall.php`, uninstall, { backup: false });
  written.push(`${dir}/uninstall.php`);

  if (input.features.includes("rest_endpoint")) {
    const rest = `<?php
add_action('rest_api_init', function () {
    register_rest_route('${input.slug}/v1', '/ping', [
        'methods' => 'GET',
        'callback' => function () { return ['pong' => true, 'plugin' => '${input.slug}']; },
        'permission_callback' => '__return_true',
    ]);
});
`;
    await target.fileWrite(`${dir}/inc/rest-endpoint.php`, rest, {
      backup: false,
    });
    written.push(`${dir}/inc/rest-endpoint.php`);
  }

  if (input.features.includes("admin_page")) {
    const admin = `<?php
add_action('admin_menu', function () {
    add_menu_page(
        '${input.name}',
        '${input.name}',
        'manage_options',
        '${input.slug}',
        function () {
            echo '<div class="wrap"><h1>${input.name}</h1><p>Scaffolded admin page.</p></div>';
        },
        'dashicons-admin-generic'
    );
});
`;
    await target.fileWrite(`${dir}/inc/admin-page.php`, admin, {
      backup: false,
    });
    written.push(`${dir}/inc/admin-page.php`);
  }

  if (input.features.includes("cli_command")) {
    const cli = `<?php
WP_CLI::add_command('${input.slug}', function ($args, $assoc_args) {
    WP_CLI::success('${input.name}: hello from CLI');
});
`;
    await target.fileWrite(`${dir}/inc/cli.php`, cli, { backup: false });
    written.push(`${dir}/inc/cli.php`);
  }

  return ScaffoldPluginOutputSchema.parse({
    run_id: runId,
    plugin_path: dir,
    files_written: written,
    activate_command: `wp plugin activate ${input.slug}`,
  });
}

function constName(slug: string): string {
  return slug.toUpperCase().replace(/-/g, "_");
}
