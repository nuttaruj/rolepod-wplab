import { validateElementorData } from "../../lib/elementorValidator.js";
import {
  WpElementorValidateDataInputSchema,
  WpElementorValidateDataOutputSchema,
  type WpElementorValidateDataInput,
  type WpElementorValidateDataOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorValidateDataToolDef = {
  name: "rolepod_wp_elementor_validate_data",
  description:
    "Walk an `_elementor_data` JSON tree and verify every widget's settings against the live widget_schema on the target. Catches the silent type-mismatch class of bug (legacy `icon` control expects a string, not a {value,library} array — passing the wrong shape renders an empty `<i class=\"Array\">`). Schema is fetched once per widget type per call. Returns errors[] + warnings[]; call BEFORE you commit the JSON via _elementor_data meta so you don't ship broken pages. Requires rolepod-wp companion v2.11+ AND Elementor active.",
  inputSchema: WpElementorValidateDataInputSchema,
};

export async function wpElementorValidateDataHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpElementorValidateDataOutput> {
  const input: WpElementorValidateDataInput =
    WpElementorValidateDataInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const result = await validateElementorData(target, input.sections, {
    strict: input.strict,
  });
  return WpElementorValidateDataOutputSchema.parse(result);
}
