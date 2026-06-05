import { bridgeFor } from "../../companion/Bridge.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import {
  WpSiteRestoreInputSchema,
  WpSiteRestoreOutputSchema,
  type WpSiteRestoreInput,
  type WpSiteRestoreOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSiteRestoreToolDef = {
  name: "rolepod_wp_site_restore",
  description:
    "Restore a site backup created by rolepod_wp_site_backup — DESTRUCTIVE (overwrites tables + wp-content files with the backup's contents). Throttled server-side in WP (cron loop, small chunks). Actions: start (id, confirm=true REQUIRED; components{db,files}; optional search_replace{oldUrl:newUrl} for serialized-data-safe URL rewrite when restoring onto a different domain; optional path_prefix to restore only part of files/) · status (poll progress). File targets are zip-slip-validated under wp-content; restore is additive-overwrite. Production targets need confirm=true. Requires companion v2.18+ on a rest target.",
  inputSchema: WpSiteRestoreInputSchema,
};

function requireCompanion(t: Target): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "RESTORE_REQUIRES_COMPANION",
      `site restore requires a rest target with the rolepod-wp companion — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { target_kind: t.kind },
    );
  }
}

export async function wpSiteRestoreHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpSiteRestoreOutput> {
  const input: WpSiteRestoreInput = WpSiteRestoreInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  requireCompanion(target);
  const bridge = await bridgeFor(target);

  if (input.action === "status") {
    return WpSiteRestoreOutputSchema.parse(await bridge.restoreStatus());
  }

  // action === "start" — destructive.
  if (!input.id) {
    throw new WplabError(
      "RESTORE_ID_REQUIRED",
      "action=start requires `id`",
      {},
    );
  }
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "restore on a production target needs confirm=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }
  const body = await bridge.restoreStart({
    id: input.id,
    confirm: input.confirm,
    components: input.components ?? { db: true, files: true },
    ...(input.search_replace ? { search_replace: input.search_replace } : {}),
    ...(input.path_prefix ? { path_prefix: input.path_prefix } : {}),
  });
  return WpSiteRestoreOutputSchema.parse(body);
}
