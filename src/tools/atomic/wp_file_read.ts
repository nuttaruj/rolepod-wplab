import {
  WpFileReadInputSchema,
  WpFileReadOutputSchema,
  type WpFileReadInput,
  type WpFileReadOutput,
} from "../../schema/tools.js";
import { sliceContent, type SliceOpts } from "../../lib/contentSlice.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileReadToolDef = {
  name: "rolepod_wp_file_read",
  description:
    "Read a file from the target WP install (any path under the install root; reads are not scope-restricted, but writes are). For large files, pass `grep` (regex, returns matching lines +/- `context`), `offset`+`limit` (line range), or `max_bytes` (cap) so the response doesn't blow the token budget — `bytes` always reports the FULL file size.",
  inputSchema: WpFileReadInputSchema,
};

export async function wpFileReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpFileReadOutput> {
  const input: WpFileReadInput = WpFileReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const result = await target.fileRead(input.path);

  const sliceOpts: SliceOpts = { ignoreCase: input.ignore_case };
  if (input.offset !== undefined) sliceOpts.offset = input.offset;
  if (input.limit !== undefined) sliceOpts.limit = input.limit;
  if (input.grep !== undefined) sliceOpts.grep = input.grep;
  if (input.context !== undefined) sliceOpts.context = input.context;
  if (input.max_bytes !== undefined) sliceOpts.maxBytes = input.max_bytes;
  const sliced = sliceContent(result.content, sliceOpts);

  return WpFileReadOutputSchema.parse({
    path: input.path,
    content: sliced.content,
    bytes: result.bytes,
    ...(sliced.sliced ? { returned_bytes: sliced.returnedBytes, truncated: sliced.truncated } : {}),
    ...(sliced.matchedLines !== undefined ? { matched_lines: sliced.matchedLines } : {}),
  });
}
