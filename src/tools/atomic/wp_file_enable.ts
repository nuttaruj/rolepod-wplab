import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const FileEnableInputSchema = z.object({
  target_id: z.string(),
  path: z.string().min(1),
});

export const wpFileEnableToolDef = {
  name: "rolepod_wp_file_enable",
  description:
    "Reverse wp_file_disable — rename <path>.disabled back to <path>. Use when a previously-disabled file is ready to re-activate. Refuses if the .disabled file does not exist OR if the active target already exists. Auto-ledgered.",
  inputSchema: FileEnableInputSchema,
};

export async function wpFileEnableHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<{ ok: true; src: string; dest: string; audit_id: string }> {
  const input = FileEnableInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  // Accept either the .disabled path OR the live path (we'll resolve to the
  // .disabled form). Reject paths that look like neither.
  const src = input.path.endsWith(".disabled")
    ? input.path
    : input.path + ".disabled";
  const dest = src.replace(/\.disabled$/, "");

  if (src === dest) {
    throw new WplabError(
      "FILE_ENABLE_BAD_PATH",
      "path does not look like a disabled file (no .disabled suffix)",
      { path: input.path },
    );
  }

  const bridge = await bridgeFor(target);
  const result = await bridge.fsRename(src, dest);

  await recordChange(target, {
    category: "file",
    subcategory: dest,
    targetDescriptor: `enable file ${src} → ${dest}`,
    beforeState: { absolute_path: result.src, status: "disabled" },
    afterState: { absolute_path: result.dest, status: "active" },
    reversible: true,
    sourceTool: "wp_file_enable",
  });

  return {
    ok: true,
    src: result.src,
    dest: result.dest,
    audit_id: result.auditId,
  };
}
