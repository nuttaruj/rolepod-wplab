import { bridgeFor } from "../../companion/Bridge.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import {
  WpElementorTemplateApplyInputSchema,
  WpElementorTemplateApplyOutputSchema,
  type WpElementorTemplateApplyInput,
  type WpElementorTemplateApplyOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorTemplateApplyToolDef = {
  name: "rolepod_wp_elementor_template_apply",
  description:
    "Companion-side counterpart to `rolepod_wp_elementor_template_export`. Takes a sections array (verbatim from an export OR built programmatically), optionally runs find/replace string substitutions, regenerates element ids so the clone doesn't collide with the source, then writes the result to the target post's `_elementor_data` meta + the standard Elementor flags. Refuses to overwrite when the target already has data unless overwrite=true. Production-guarded. Requires rolepod-wp companion v2.12+.",
  inputSchema: WpElementorTemplateApplyInputSchema,
};

export async function wpElementorTemplateApplyHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpElementorTemplateApplyOutput> {
  const input: WpElementorTemplateApplyInput = WpElementorTemplateApplyInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_TEMPLATE_APPLY_UNSUPPORTED_TARGET",
      "template_apply currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const bridgeInput: {
    targetPostId: number;
    sections: ReadonlyArray<Record<string, unknown>>;
    replaceStrings?: Record<string, string>;
    overwrite?: boolean;
  } = {
    targetPostId: input.target_post_id,
    sections: input.sections,
    overwrite: input.overwrite,
  };
  if (input.replace_strings !== undefined) {
    bridgeInput.replaceStrings = input.replace_strings;
  }
  const r = await bridge.elementorTemplateApply(bridgeInput);
  await recordChange(target, {
    category: "post",
    subcategory: `meta:${input.target_post_id}`,
    targetDescriptor: `elementor template-apply (${r.sectionCount} sections)`,
    afterState: {
      target_post_id: r.targetPostId,
      section_count: r.sectionCount,
      replacements_applied: r.replacementsApplied,
    },
    reversible: false,
    sourceTool: "wp_elementor_template_apply",
  });
  return WpElementorTemplateApplyOutputSchema.parse({
    target_post_id: r.targetPostId,
    section_count: r.sectionCount,
    replacements_applied: r.replacementsApplied,
  });
}
