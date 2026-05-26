import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
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
  await target.fileWrite(
    `${blockDir}/block.json`,
    JSON.stringify(blockJson, null, 2),
    { backup: false },
  );
  written.push(`${blockDir}/block.json`);

  const indexJs = renderIndexJs(input);
  await target.fileWrite(`${blockDir}/index.js`, indexJs, { backup: false });
  written.push(`${blockDir}/index.js`);

  const styleCss = `/* ${input.title} block styles */\n.wp-block-${slug} { padding: 1rem; }\n`;
  await target.fileWrite(`${blockDir}/style.css`, styleCss, { backup: false });
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
$class = 'wp-block-' . sanitize_html_class('${slug}');
?>
<div class="<?php echo esc_attr($class); ?>">
  <p><?php esc_html_e('${input.title}', '${input.plugin_slug}'); ?></p>
</div>
`;
    await target.fileWrite(`${blockDir}/render.php`, renderPhp, {
      backup: false,
    });
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

function renderIndexJs(input: ScaffoldBlockInput): string {
  return `import { registerBlockType } from '@wordpress/blocks'
import { useBlockProps } from '@wordpress/block-editor'

registerBlockType('${input.block_slug}', {
  edit: () => {
    const blockProps = useBlockProps()
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <div {...blockProps}>
        <p>${input.title} (editor view)</p>
      </div>
    )
  },
  ${
    input.render_strategy === "dynamic"
      ? `// dynamic: render handled server-side in render.php`
      : `save: () => {
    const blockProps = useBlockProps.save()
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <div {...blockProps}>
        <p>${input.title}</p>
      </div>
    )
  },`
  }
})
`;
}
