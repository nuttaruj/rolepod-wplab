import { elementorAdapter } from "../../adapters/elementor/read.js";
import {
  ElementorReadInputSchema,
  ElementorReadOutputSchema,
  type ElementorReadInput,
  type ElementorReadOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorReadToolDef = {
  name: "rolepod_wp_elementor_read",
  description:
    "Read Elementor data. Without page_id: lists Elementor-rendered pages of the given type. With page_id: dumps the widget tree from `_elementor_data` meta. Shell targets work directly; RestTarget without companion is limited to list.",
  inputSchema: ElementorReadInputSchema,
};

export async function wpElementorReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ElementorReadOutput> {
  const input: ElementorReadInput = ElementorReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const detected = await elementorAdapter.detect(target);
  if (!detected) {
    return ElementorReadOutputSchema.parse({
      mode: input.page_id !== undefined ? "page" : "list",
      detected: false,
    });
  }

  if (input.page_id !== undefined) {
    const page = await elementorAdapter.read.getPage(target, input.page_id);
    return ElementorReadOutputSchema.parse({
      mode: "page",
      detected: true,
      page,
    });
  }
  const pages = await elementorAdapter.read.listPages(target, {
    type: input.type,
    per_page: input.per_page,
  });
  return ElementorReadOutputSchema.parse({
    mode: "list",
    detected: true,
    pages,
  });
}
