import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import {
  WpSiteBackupInputSchema,
  WpSiteBackupOutputSchema,
  type WpSiteBackupInput,
  type WpSiteBackupOutput,
} from "../../schema/tools.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSiteBackupToolDef = {
  name: "rolepod_wp_site_backup",
  description:
    "Throttled, server-side site backup in WordPress (via the rolepod-wp companion). Produces a browsable ZIP per backup (manifest.json + database.sql + files/ mirroring wp-content). The work runs in WP on a cron loop in small chunks — it never spikes CPU — so `start` returns immediately and you poll with action=status. Actions: start (components{db,uploads,themes,plugins,muplugins}, compress, exclude[]) · status (current job + progress) · list (finished backups) · inspect (id [, entry] — read the zip's central directory or a single member like manifest.json/database.sql WITHOUT extracting) · cancel · delete (id). Requires companion v2.17+ on a rest target. Restore via rolepod_wp_site_restore.",
  inputSchema: WpSiteBackupInputSchema,
};

function requireCompanion(t: Target): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "BACKUP_REQUIRES_COMPANION",
      `site backup requires a rest target with the rolepod-wp companion — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { target_kind: t.kind },
    );
  }
}

export async function wpSiteBackupHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpSiteBackupOutput> {
  const input: WpSiteBackupInput = WpSiteBackupInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  requireCompanion(target);
  const bridge = await bridgeFor(target);

  let body: Record<string, unknown>;
  switch (input.action) {
    case "start":
      body = await bridge.backupStart({
        components: input.components ?? {},
        compress: input.compress ?? true,
        exclude: input.exclude ?? [],
      });
      break;
    case "status":
      body = await bridge.backupStatus();
      break;
    case "list":
      body = await bridge.backupList();
      break;
    case "inspect":
      if (!input.id) {
        throw new WplabError(
          "BACKUP_INSPECT_ID_REQUIRED",
          "action=inspect requires `id`",
          {},
        );
      }
      body = await bridge.backupInspect({
        id: input.id,
        ...(input.entry ? { entry: input.entry } : {}),
        ...(input.max_bytes ? { max_bytes: input.max_bytes } : {}),
      });
      break;
    case "cancel":
      body = await bridge.backupCancel();
      break;
    case "delete":
      if (!input.id) {
        throw new WplabError(
          "BACKUP_DELETE_ID_REQUIRED",
          "action=delete requires `id`",
          {},
        );
      }
      body = await bridge.backupDelete(input.id);
      break;
    default:
      body = await bridge.backupStatus();
  }
  return WpSiteBackupOutputSchema.parse(body);
}
