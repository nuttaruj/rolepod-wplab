import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpElementorTemplateExportInputSchema,
  WpElementorTemplateExportOutputSchema,
  type WpElementorTemplateExportInput,
  type WpElementorTemplateExportOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorTemplateExportToolDef = {
  name: "rolepod_wp_elementor_template_export",
  description:
    "Export the parsed `_elementor_data` JSON of an existing Elementor page. Returns the section tree, plus the list of distinct widget types used (handy when paired with elementor_widget_schema for each). Lets agents clone editor-built pages programmatically. Read-only; works on production. Requires rolepod-wp companion v2.11+ AND Elementor active.",
  inputSchema: WpElementorTemplateExportInputSchema,
};

export async function wpElementorTemplateExportHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpElementorTemplateExportOutput> {
  const input: WpElementorTemplateExportInput =
    WpElementorTemplateExportInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_TEMPLATE_EXPORT_UNSUPPORTED_TARGET",
      "elementor_template_export currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.elementorTemplateExport(input.post_id);
  return WpElementorTemplateExportOutputSchema.parse(r);
}
