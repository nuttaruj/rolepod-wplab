import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpElementorWidgetSchemaInputSchema,
  WpElementorWidgetSchemaOutputSchema,
  type WpElementorWidgetSchemaInput,
  type WpElementorWidgetSchemaOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorWidgetSchemaToolDef = {
  name: "rolepod_wp_elementor_widget_schema",
  description:
    "Introspect an Elementor widget's controls registry. Pass `widget` to get the full settings shape (type/label/default/options) for that widget — use this BEFORE building _elementor_data JSON to know which keys exist and what shape they expect. Omit `widget` to list every registered widget type on the target. Read-only; works on production. Requires rolepod-wp companion v2.11+ AND Elementor active.",
  inputSchema: WpElementorWidgetSchemaInputSchema,
};

export async function wpElementorWidgetSchemaHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpElementorWidgetSchemaOutput> {
  const input: WpElementorWidgetSchemaInput =
    WpElementorWidgetSchemaInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_WIDGET_SCHEMA_UNSUPPORTED_TARGET",
      "elementor_widget_schema currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.elementorWidgetSchema(input.widget);
  return WpElementorWidgetSchemaOutputSchema.parse(r);
}
