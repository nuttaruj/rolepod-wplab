import {
  WpFileReadInputSchema,
  WpFileReadOutputSchema,
  type WpFileReadInput,
  type WpFileReadOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileReadToolDef = {
  name: "rolepod_wp_file_read",
  description:
    "Read a file from the target WP install (any path under the install root; reads are not scope-restricted, but writes are).",
  inputSchema: WpFileReadInputSchema,
};

export async function wpFileReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpFileReadOutput> {
  const input: WpFileReadInput = WpFileReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const result = await target.fileRead(input.path);
  return WpFileReadOutputSchema.parse({
    path: input.path,
    content: result.content,
    bytes: result.bytes,
  });
}
