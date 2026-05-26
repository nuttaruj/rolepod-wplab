import { oxygenAdapter } from "../../adapters/oxygen/read.js";
import {
  OxygenReadInputSchema,
  OxygenReadOutputSchema,
  type OxygenReadInput,
  type OxygenReadOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpOxygenReadToolDef = {
  name: "rolepod_wp_oxygen_read",
  description:
    "Read Oxygen Builder pages. Without page_id → list pages flagged with ct_builder_shortcodes. With page_id → dumps shortcodes + json slug.",
  inputSchema: OxygenReadInputSchema,
};

export async function wpOxygenReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<OxygenReadOutput> {
  const input: OxygenReadInput = OxygenReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const detected = await oxygenAdapter.detect(target);
  if (!detected) {
    return OxygenReadOutputSchema.parse({
      mode: input.page_id ? "page" : "list",
      detected: false,
    });
  }
  if (input.page_id !== undefined) {
    const page = await oxygenAdapter.read.getPage(target, input.page_id);
    return OxygenReadOutputSchema.parse({ mode: "page", detected: true, page });
  }
  const pages = await oxygenAdapter.read.listPages(target, {
    type: input.type,
    per_page: input.per_page,
  });
  return OxygenReadOutputSchema.parse({ mode: "list", detected: true, pages });
}
