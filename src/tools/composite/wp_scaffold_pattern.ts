import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { writeManagedFile } from "../../companion/managedWrite.js";
import {
  ScaffoldPatternInputSchema,
  ScaffoldPatternOutputSchema,
  type ScaffoldPatternInput,
  type ScaffoldPatternOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import {
  provenancePhpHeader,
  withProvenanceSuffix,
} from "../../lib/provenance.js";

export const wpScaffoldPatternToolDef = {
  name: "rolepod_wp_scaffold_pattern",
  description:
    'Scaffold a block pattern PHP file inside an existing theme or plugin. Pattern slug must be namespaced (e.g. "my-theme/cta-card"). Pattern files land under wp-content/<host>/<host_slug>/patterns/<slug>.php.',
  inputSchema: ScaffoldPatternInputSchema,
};

export async function wpScaffoldPatternHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<ScaffoldPatternOutput> {
  const input: ScaffoldPatternInput = ScaffoldPatternInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  const runId = makeRunId();
  const [ns, slug] = input.pattern_slug.split("/");
  if (!ns || !slug) {
    throw new WplabError(
      "SCAFFOLD_PATTERN_BAD_SLUG",
      'pattern_slug must be "namespace/slug"',
      {},
    );
  }
  const hostDir = input.host === "theme" ? "themes" : "plugins";
  const relPath = `wp-content/${hostDir}/${input.host_slug}/patterns/${slug}.php`;

  const header = [
    "<?php",
    "/**",
    ` * Title: ${escapeHeader(input.title)}`,
    ` * Slug: ${input.pattern_slug}`,
    ` * Categories: ${input.categories.join(", ")}`,
    ...(input.description
      ? [
          ` * Description: ${escapeHeader(withProvenanceSuffix(input.description))}`,
        ]
      : []),
    ...provenancePhpHeader().split("\n"),
    " * Block Types: core/post-content",
    " */",
    "?>",
    "",
  ].join("\n");

  const file = header + input.content + "\n";
  await writeManagedFile(target, relPath, file, {
    backup: false,
    sourceTool: "wp_scaffold_pattern",
  });

  return ScaffoldPatternOutputSchema.parse({
    run_id: runId,
    file_written: relPath,
  });
}

function escapeHeader(s: string): string {
  return s.replace(/[\r\n]+/g, " ").slice(0, 200);
}
