import { bridgeFor } from "../../companion/Bridge.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import {
  WpElementorWidgetAttributeInputSchema,
  WpElementorWidgetAttributeOutputSchema,
  type WpElementorWidgetAttributeInput,
  type WpElementorWidgetAttributeOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorWidgetAttributeToolDef = {
  name: "rolepod_wp_elementor_widget_attribute",
  description:
    "Persist arbitrary `data-*` attributes on an Elementor widget (by element id). Stored in `_rolepod_widget_attrs` post meta + emitted as a JSON+JS bridge script in wp_footer on the public page. The theme's effect JS reads the bridge map and applies the attrs to `[data-id=\"<widget_id>\"]` BEFORE init runs — restores data-scramble/data-magnet/data-tilt/data-typer style effects that Elementor's render strips. Pass attrs={} to clear all attrs for the widget. Requires rolepod-wp companion v2.12+.",
  inputSchema: WpElementorWidgetAttributeInputSchema,
};

export async function wpElementorWidgetAttributeHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpElementorWidgetAttributeOutput> {
  const input: WpElementorWidgetAttributeInput = WpElementorWidgetAttributeInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_WIDGET_ATTR_UNSUPPORTED_TARGET",
      "widget_attribute currently requires a `rest` target (companion-side meta storage).",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.elementorWidgetAttribute(input.post_id, input.widget_id, input.attrs);
  return WpElementorWidgetAttributeOutputSchema.parse({
    post_id: r.postId,
    widget_id: r.widgetId,
    attrs_now: r.attrsNow,
    widgets_total: r.widgetsTotal,
  });
}
