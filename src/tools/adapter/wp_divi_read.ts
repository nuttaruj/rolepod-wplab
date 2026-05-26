import { diviAdapter } from "../../adapters/divi/read.js";
import {
  DiviReadInputSchema,
  DiviReadOutputSchema,
  type DiviReadInput,
  type DiviReadOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpDiviReadToolDef = {
  name: "rolepod_wp_divi_read",
  description:
    "Read Divi Builder pages. Without page_id → returns list flagged with _et_pb_use_builder=on. With page_id → dumps full post_content shortcode + builder meta.",
  inputSchema: DiviReadInputSchema,
};

export async function wpDiviReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<DiviReadOutput> {
  const input: DiviReadInput = DiviReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const detected = await diviAdapter.detect(target);
  if (!detected) {
    return DiviReadOutputSchema.parse({
      mode: input.page_id ? "page" : "list",
      detected: false,
    });
  }
  if (input.page_id !== undefined) {
    const page = await diviAdapter.read.getPage(target, input.page_id);
    return DiviReadOutputSchema.parse({ mode: "page", detected: true, page });
  }
  const pages = await diviAdapter.read.listPages(target, {
    type: input.type,
    per_page: input.per_page,
  });
  return DiviReadOutputSchema.parse({ mode: "list", detected: true, pages });
}
