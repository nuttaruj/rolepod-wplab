import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { phpQuote } from "../../lib/phpEmbed.js";
import { writeManagedFile } from "../../companion/managedWrite.js";
import {
  ScaffoldBlockInputSchema,
  ScaffoldBlockOutputSchema,
  type ScaffoldBlockInput,
  type ScaffoldBlockOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpScaffoldBlockToolDef = {
  name: "rolepod_wp_scaffold_block",
  description:
    'Generate a minimum-viable Gutenberg block (block.json + index.js + render.php for dynamic; save() for static + style.css) into an existing plugin on the target. Requires allow_destructive=true. Production guard applies. Block slug must be namespaced (e.g. "my-team/testimonial-card").',
  inputSchema: ScaffoldBlockInputSchema,
};

export async function wpScaffoldBlockHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<ScaffoldBlockOutput> {
  const input: ScaffoldBlockInput = ScaffoldBlockInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const runId = makeRunId();
  const [ns, slug] = input.block_slug.split("/");
  if (!ns || !slug) {
    throw new WplabError(
      "SCAFFOLD_BLOCK_BAD_SLUG",
      'block_slug must be "namespace/slug"',
      {},
    );
  }
  const blockDir = `wp-content/plugins/${input.plugin_slug}/blocks/${slug}`;
  const written: string[] = [];
  // Route every file through the managed pipeline: php -l on render.php,
  // JSON-validate block.json, + a ledger row per file (rest+companion targets).
  const emit = (path: string, content: string) =>
    writeManagedFile(target, path, content, {
      backup: false,
      sourceTool: "wp_scaffold_block",
    });

  const blockJson = {
    $schema: "https://schemas.wp.org/trunk/block.json",
    apiVersion: 3,
    name: input.block_slug,
    title: input.title,
    description: input.description ?? input.title,
    category: input.category,
    icon: input.icon,
    textdomain: input.plugin_slug,
    editorScript: "file:./index.js",
    style: "file:./style.css",
    ...(input.render_strategy === "dynamic"
      ? { render: "file:./render.php" }
      : {}),
    attributes: {},
    supports: { html: false },
  };
  await emit(`${blockDir}/block.json`, JSON.stringify(blockJson, null, 2));
  written.push(`${blockDir}/block.json`);

  const indexJs = renderIndexJs(input);
  await emit(`${blockDir}/index.js`, indexJs);
  written.push(`${blockDir}/index.js`);

  // WP looks for <script>.asset.php next to an enqueued script to learn its
  // dependency handles + version. Our no-build index.js uses the wp-blocks /
  // wp-block-editor / wp-element globals, so it must be enqueued AFTER them —
  // without this file WP enqueues with no deps and the globals are undefined.
  const assetPhp = `<?php return array('dependencies' => array('wp-blocks', 'wp-block-editor', 'wp-element'), 'version' => ${phpQuote(runId)});\n`;
  await emit(`${blockDir}/index.asset.php`, assetPhp);
  written.push(`${blockDir}/index.asset.php`);

  const styleCss = `/* ${input.title} block styles */\n.wp-block-${slug} { padding: 1rem; }\n`;
  await emit(`${blockDir}/style.css`, styleCss);
  written.push(`${blockDir}/style.css`);

  if (input.render_strategy === "dynamic") {
    const renderPhp = `<?php
/**
 * Server-side render for ${input.block_slug}.
 *
 * @param array  $attributes  Block attributes.
 * @param string $content     Inner HTML (empty for dynamic blocks).
 * @param WP_Block $block     Block instance.
 */
$class = 'wp-block-' . sanitize_html_class(${phpQuote(slug)});
?>
<div class="<?php echo esc_attr($class); ?>">
  <p><?php echo esc_html(${phpQuote(input.title)}); ?></p>
</div>
`;
    await emit(`${blockDir}/render.php`, renderPhp);
    written.push(`${blockDir}/render.php`);
  }

  const nextSteps = [
    `Register the block in the plugin's main PHP file:  register_block_type( __DIR__ . '/blocks/${slug}' );`,
    `Run 'wp cache flush' on the target so editor picks up the new block.`,
  ];

  return ScaffoldBlockOutputSchema.parse({
    run_id: runId,
    files_written: written,
    next_steps: nextSteps,
  });
}

/**
 * No-build editor script. WP enqueues index.js straight to the browser (no
 * webpack/babel), so it must be plain ES5-ish JS with NO `import` and NO JSX —
 * both are SyntaxErrors in a browser. We use the wp.* globals + createElement.
 * User strings are embedded via JSON.stringify (safe in a JS string context).
 */
function renderIndexJs(input: ScaffoldBlockInput): string {
  const slugLit = JSON.stringify(input.block_slug);
  const editorText = JSON.stringify(`${input.title} (editor view)`);
  const saveText = JSON.stringify(input.title);
  const saveFn =
    input.render_strategy === "dynamic"
      ? // Dynamic block: render.php produces the front-end markup, so save() must
        // return null (persisting markup would double-render / desync).
        `save: function () { return null; }`
      : `save: function () {
      return el('div', useBlockProps.save(), el('p', null, ${saveText}));
    }`;
  return `( function ( blocks, blockEditor, element ) {
  var el = element.createElement;
  var useBlockProps = blockEditor.useBlockProps;
  blocks.registerBlockType( ${slugLit}, {
    edit: function () {
      return el('div', useBlockProps(), el('p', null, ${editorText}));
    },
    ${saveFn}
  } );
} )( window.wp.blocks, window.wp.blockEditor, window.wp.element );
`;
}
