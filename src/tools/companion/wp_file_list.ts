import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpFileListInputSchema,
  WpFileListOutputSchema,
  type WpFileListInput,
  type WpFileListOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileListToolDef = {
  name: "rolepod_wp_file_list",
  description:
    "Recursive directory listing. Returns one entry per file/dir with relative path, type, byte size, and mtime. depth=0 lists nothing (returns the root entry only); depth=2 (default) lists the dir + 2 levels of children. Caps at 2000 entries — `truncated:true` signals more existed. Read-only; works on production targets. Requires rolepod-wp companion v2.11+.",
  inputSchema: WpFileListInputSchema,
};

export async function wpFileListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpFileListOutput> {
  const input: WpFileListInput = WpFileListInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (target.kind !== "rest") {
    throw new WplabError(
      "FS_LIST_UNSUPPORTED_TARGET",
      "file_list currently requires a `rest` target (uses the companion endpoint).",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.fileList(input.path, {
    depth: input.depth,
    includeHidden: input.include_hidden,
  });
  return WpFileListOutputSchema.parse({
    root: r.root,
    truncated: r.truncated,
    entries: r.entries,
  });
}
