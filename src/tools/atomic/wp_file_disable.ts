import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const FileDisableInputSchema = z.object({
  target_id: z.string(),
  path: z.string().min(1),
});

export const wpFileDisableToolDef = {
  name: "rolepod_wp_file_disable",
  description:
    "Take a file off-line by renaming it to <path>.disabled. PHP files are then invisible to WP's autoloader / plugin loader — no parse, no execute. Useful for quickly disabling a misbehaving MU-plugin, plugin file, or theme file without DB writes. Reversible via wp_file_enable. Auto-ledgered.",
  inputSchema: FileDisableInputSchema,
};

export async function wpFileDisableHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<{ ok: true; src: string; dest: string; audit_id: string }> {
  const input = FileDisableInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  if (input.path.endsWith(".disabled")) {
    throw new WplabError(
      "FILE_DISABLE_ALREADY_DISABLED",
      "path already ends with .disabled — use wp_file_enable to reverse",
      { path: input.path },
    );
  }

  const bridge = await bridgeFor(target);
  const dest = input.path + ".disabled";
  const result = await bridge.fsRename(input.path, dest);

  await recordChange(target, {
    category: "file",
    subcategory: input.path,
    targetDescriptor: `disable file ${input.path} → ${dest}`,
    beforeState: { absolute_path: result.src, status: "active" },
    afterState: { absolute_path: result.dest, status: "disabled" },
    reversible: true,
    sourceTool: "wp_file_disable",
  });

  return { ok: true, src: result.src, dest: result.dest, audit_id: result.auditId };
}
