import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpDirEnsureInputSchema,
  WpDirEnsureOutputSchema,
  type WpDirEnsureInput,
  type WpDirEnsureOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpDirEnsureToolDef = {
  name: "rolepod_wp_dir_ensure",
  description:
    "`mkdir -p` for scoped wp-content paths. Idempotent — returns success when the directory exists regardless of whether it was created or already there. Requires rolepod-wp companion v2.11+.",
  inputSchema: WpDirEnsureInputSchema,
};

export async function wpDirEnsureHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpDirEnsureOutput> {
  const input: WpDirEnsureInput = WpDirEnsureInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);
  if (target.kind !== "rest") {
    throw new WplabError(
      "DIR_ENSURE_UNSUPPORTED_TARGET",
      "dir_ensure currently requires a `rest` target (uses the companion endpoint).",
      { target_kind: target.kind },
    );
  }
  const bridge = await bridgeFor(target);
  const r = await bridge.dirEnsure(input.path);
  return WpDirEnsureOutputSchema.parse({
    path: r.path,
    absolute_path: r.absolutePath,
    created: r.created,
  });
}
