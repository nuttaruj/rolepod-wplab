import { oxygenAdapter } from "../../adapters/oxygen/read.js";
import { oxygenWrite } from "../../adapters/oxygen/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  OxygenWriteInputSchema,
  OxygenWriteOutputSchema,
  type OxygenWriteInput,
  type OxygenWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpOxygenWriteToolDef = {
  name: "rolepod_wp_oxygen_write",
  description:
    "Replace ct_builder_shortcodes post meta with a new Oxygen shortcode payload. LIMITATION: this writes ct_builder_shortcodes ONLY. Oxygen 4.0+ stores the source of truth in a ct_builder_json tree and regenerates the shortcodes from it — on such pages this write may be overwritten or not render (the tool detects ct_builder_json and warns in `note`). Writing ct_builder_json directly is NOT supported (its structure is unverified — guessing it would risk data loss). Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: OxygenWriteInputSchema,
};

/** Best-effort probe: does this page carry a ct_builder_json tree (Oxygen 4.0+)? */
async function hasCtBuilderJson(
  target: Parameters<typeof oxygenWrite.updatePageShortcodes>[0],
  postId: number,
): Promise<boolean> {
  try {
    const r = await target.wpCli([
      "post",
      "meta",
      "get",
      String(postId),
      "ct_builder_json",
    ]);
    return r.exitCode === 0 && r.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function wpOxygenWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<OxygenWriteOutput> {
  const input: OxygenWriteInput = OxygenWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "oxygen_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await oxygenAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "Oxygen not active on target",
      { targetId: input.target_id },
    );
  }
  const hasJson = await hasCtBuilderJson(target, input.post_id);

  const result = await oxygenWrite.updatePageShortcodes(
    target,
    input.post_id,
    input.shortcodes,
  );

  const note = hasJson
    ? "WARNING: this page has a ct_builder_json tree (Oxygen 4.0+). This write updated ct_builder_shortcodes ONLY — Oxygen may regenerate the shortcodes from the JSON tree and OVERWRITE this change, or the front end may render from the stale JSON. Open + re-save the page in the Oxygen editor to sync. Writing ct_builder_json directly is unsupported (its structure is unverified)."
    : "Updated ct_builder_shortcodes. If this Oxygen version also stores a ct_builder_json tree, re-save the page in the Oxygen editor to keep them in sync.";

  return OxygenWriteOutputSchema.parse({
    bytes_written: result.bytesWritten,
    backup_path: result.backupPath,
    ct_builder_json_present: hasJson,
    note,
  });
}
