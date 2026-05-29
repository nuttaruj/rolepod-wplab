import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import {
  WpFileCopyInputSchema,
  WpFileCopyOutputSchema,
  type WpFileCopyInput,
  type WpFileCopyOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFileCopyToolDef = {
  name: "rolepod_wp_file_copy",
  description:
    "Copy one scoped file to another scoped path. Auto-creates the destination's parent directory. Refuses to overwrite the destination unless `overwrite=true`. Production-guarded. Requires rolepod-wp companion v2.11+.",
  inputSchema: WpFileCopyInputSchema,
};

export async function wpFileCopyHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpFileCopyOutput> {
  const input: WpFileCopyInput = WpFileCopyInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "FS_COPY_UNSUPPORTED_TARGET",
      "file_copy currently requires a `rest` target (uses the companion endpoint).",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.fileCopy(input.from, input.to, {
    overwrite: input.overwrite,
  });
  await recordChange(target, {
    category: "file",
    subcategory: input.to,
    targetDescriptor: `copy ${input.from} → ${input.to} (${r.bytes} bytes)`,
    beforeState: { from: input.from, to: input.to },
    afterState: { from: input.from, to: input.to, bytes: r.bytes },
    reversible: false,
    sourceTool: "wp_file_copy",
  });
  return WpFileCopyOutputSchema.parse({
    from: r.from,
    to: r.to,
    bytes: r.bytes,
  });
}
