import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { writeManagedFile } from "../../companion/managedWrite.js";
import { escapeBlockComment } from "../../lib/phpEmbed.js";
import {
  ScaffoldThemeInputSchema,
  ScaffoldThemeOutputSchema,
  type ScaffoldThemeInput,
  type ScaffoldThemeOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpScaffoldThemeToolDef = {
  name: "rolepod_wp_scaffold_theme",
  description:
    "Bootstrap a minimum-viable WordPress block-theme (style.css + theme.json + functions.php + templates/index.html) under wp-content/themes/<slug>/. Requires allow_destructive=true. Production guard applies.",
  inputSchema: ScaffoldThemeInputSchema,
};

export async function wpScaffoldThemeHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<ScaffoldThemeOutput> {
  const input: ScaffoldThemeInput = ScaffoldThemeInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const runId = makeRunId();
  const dir = `wp-content/themes/${input.slug}`;
  const written: string[] = [];
  const emit = (path: string, content: string) =>
    writeManagedFile(target, path, content, {
      backup: false,
      sourceTool: "wp_scaffold_theme",
    });
  // Name/description land in a CSS `/* */` header + PHP docblock — neutralize `*/`.
  const safeName = escapeBlockComment(input.name);
  const safeDesc = escapeBlockComment(input.description ?? input.name);

  const styleCss = `/*
Theme Name: ${safeName}
Description: ${safeDesc}
Author: ${input.author}
Version: 0.1.0
Requires at least: 6.0
Requires PHP: 7.4
Text Domain: ${input.slug}
*/
`;
  await emit(`${dir}/style.css`, styleCss);
  written.push(`${dir}/style.css`);

  const themeJson = {
    $schema: "https://schemas.wp.org/trunk/theme.json",
    version: 2,
    settings: {
      color: {
        palette: [{ slug: "primary", color: "#1a1a2e", name: "Primary" }],
      },
      typography: {
        fontSizes: [{ slug: "normal", size: "1rem", name: "Normal" }],
      },
    },
    styles: {
      typography: { fontSize: "var(--wp--preset--font-size--normal)" },
    },
  };
  await emit(`${dir}/theme.json`, JSON.stringify(themeJson, null, 2));
  written.push(`${dir}/theme.json`);

  const functions = `<?php
/**
 * ${safeName} — functions.php
 */
if (!defined('ABSPATH')) {
    exit;
}

add_action('after_setup_theme', function () {
    add_theme_support('wp-block-styles');
    add_theme_support('responsive-embeds');
    add_theme_support('editor-styles');
});
`;
  await emit(`${dir}/functions.php`, functions);
  written.push(`${dir}/functions.php`);

  const indexHtml = `<!-- wp:template-part {"slug":"header","tagName":"header"} /-->

<!-- wp:group {"tagName":"main","layout":{"type":"constrained"}} -->
<main class="wp-block-group">
  <!-- wp:post-content /-->
</main>
<!-- /wp:group -->

<!-- wp:template-part {"slug":"footer","tagName":"footer"} /-->
`;
  await emit(`${dir}/templates/index.html`, indexHtml);
  written.push(`${dir}/templates/index.html`);

  const partsHeader = `<!-- wp:group {"tagName":"div","layout":{"type":"constrained"}} -->
<div class="wp-block-group">
  <!-- wp:site-title /-->
</div>
<!-- /wp:group -->
`;
  await emit(`${dir}/parts/header.html`, partsHeader);
  written.push(`${dir}/parts/header.html`);

  const partsFooter = `<!-- wp:group {"tagName":"div","layout":{"type":"constrained"}} -->
<div class="wp-block-group">
  <!-- wp:paragraph -->
  <p>© ${input.name}</p>
  <!-- /wp:paragraph -->
</div>
<!-- /wp:group -->
`;
  await emit(`${dir}/parts/footer.html`, partsFooter);
  written.push(`${dir}/parts/footer.html`);

  return ScaffoldThemeOutputSchema.parse({
    run_id: runId,
    theme_path: dir,
    files_written: written,
    activate_command: `wp theme activate ${input.slug}`,
  });
}
