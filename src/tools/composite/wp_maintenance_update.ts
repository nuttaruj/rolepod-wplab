import { ProdGuard } from "../../safety/ProdGuard.js";
import { assertSingleSite } from "../../safety/multisiteGuard.js";
import { bridgeFor, type CompanionBridge } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import {
  MaintenanceUpdateInputSchema,
  MaintenanceUpdateOutputSchema,
  type MaintenanceUpdateInput,
  type MaintenanceUpdateOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 900_000;

export const wpMaintenanceUpdateToolDef = {
  name: "rolepod_wp_maintenance_update",
  description:
    "Safely update plugins / themes / core: back up first (scope=core needs a pre-made backup_id — core FILES are not captured by a fresh backup), flip maintenance-mode ON, run the update, flip maintenance-mode OFF (in a finally, so an update that throws never leaves the site stuck behind the maintenance page), then health-probe. On red with auto_rollback: core is pinned back with `core update --version=<old> --force` + a db restore; plugin/theme restore the backup — then it RE-PROBES and only claims rolled_back:true if the site is green again, else rolled_back:false + a loud manual-recovery note with the backup_id. REST + companion only; single-site only; production needs confirm_production=true. Ledger category=maintenance (reversible:false for core — a db upgrade + core files have no clean ledger undo).",
  inputSchema: MaintenanceUpdateInputSchema,
};

function requireRestCompanion(t: Target): void {
  if (t.kind !== "rest" || !t.companion?.enabled) {
    throw new WplabError(
      "MAINTENANCE_REQUIRES_COMPANION",
      `wp_maintenance_update needs a rest target with the rolepod-wp companion (for backup/restore) — got ${t.kind} (companion: ${t.companion?.enabled ? "yes" : "no"})`,
      { target_kind: t.kind },
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Start a full backup, poll to completion, return its id. */
async function backupAndWait(
  bridge: CompanionBridge,
  deadline: number,
): Promise<string> {
  const started = await bridge.backupStart({
    components: {
      db: true,
      plugins: true,
      themes: true,
      muplugins: true,
      uploads: true,
    },
    compress: true,
    exclude: [],
  });
  if (started["ok"] !== true) {
    throw new WplabError(
      "MAINTENANCE_BACKUP_FAILED",
      `pre-update backup did not start: ${String(started["error"] ?? "unknown")}`,
      { response: started },
    );
  }
  const id = String(
    ((started["job"] ?? {}) as Record<string, unknown>)["id"] ?? "",
  );
  if (!id)
    throw new WplabError("MAINTENANCE_BACKUP_FAILED", "backup returned no id", {
      response: started,
    });
  for (;;) {
    const st = ((await bridge.backupStatus())["job"] ?? {}) as Record<
      string,
      unknown
    >;
    const status = String(st["status"] ?? "");
    if (status === "done") return id;
    if (status === "error")
      throw new WplabError("MAINTENANCE_BACKUP_FAILED", "backup errored", {
        status: st,
      });
    if (Date.now() > deadline)
      throw new WplabError("MAINTENANCE_TIMEOUT", "backup did not finish", {
        status: st,
      });
    await sleep(POLL_INTERVAL_MS);
  }
}

async function restoreAndWait(
  bridge: CompanionBridge,
  id: string,
  components: { db: boolean; files: boolean },
  deadline: number,
): Promise<void> {
  await bridge.restoreStart({ id, confirm: true, components });
  for (;;) {
    const st = ((await bridge.restoreStatus())["job"] ?? {}) as Record<
      string,
      unknown
    >;
    const status = String(st["status"] ?? "");
    if (status === "done") return;
    if (status === "error")
      throw new WplabError("MAINTENANCE_RESTORE_FAILED", "restore errored", {
        status: st,
      });
    if (Date.now() > deadline)
      throw new WplabError("MAINTENANCE_TIMEOUT", "restore did not finish", {
        status: st,
      });
    await sleep(POLL_INTERVAL_MS);
  }
}

async function probeHealthy(target: Target): Promise<boolean> {
  try {
    const r = await target.rest({ method: "GET", path: "/" });
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}

async function runUpdate(
  target: Target,
  input: MaintenanceUpdateInput,
): Promise<string[]> {
  if (input.scope === "core") {
    const up = await target.wpCli(["core", "update"], {
      allowDestructive: true,
    });
    if (up.exitCode !== 0) {
      throw new WplabError(
        "MAINTENANCE_UPDATE_FAILED",
        "wp core update failed",
        {
          stderr: up.stderr.slice(0, 200),
        },
      );
    }
    await target.wpCli(["core", "update-db"], { allowDestructive: true });
    return ["core"];
  }
  const verb = input.scope; // plugin | theme
  const args = [verb, "update"];
  if (input.slugs && input.slugs.length > 0) args.push(...input.slugs);
  else args.push("--all");
  const up = await target.wpCli(args, { allowDestructive: true });
  if (up.exitCode !== 0) {
    throw new WplabError(
      "MAINTENANCE_UPDATE_FAILED",
      `wp ${verb} update failed`,
      { stderr: up.stderr.slice(0, 200) },
    );
  }
  return input.slugs && input.slugs.length > 0 ? input.slugs : [`all ${verb}s`];
}

export async function wpMaintenanceUpdateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<MaintenanceUpdateOutput> {
  const input: MaintenanceUpdateInput = MaintenanceUpdateInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  requireRestCompanion(target);
  await assertSingleSite(target);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm_production) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "maintenance_update blocked on production-matched target — pass confirm_production=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  const bridge = await bridgeFor(target);
  const deadline = () => Date.now() + DEFAULT_TIMEOUT_MS;

  // Backup: core reuses a pre-made backup (its files aren't in a fresh one).
  let backupId: string;
  let oldCoreVersion = "";
  if (input.scope === "core") {
    if (!input.backup_id) {
      throw new WplabError(
        "MAINTENANCE_CORE_BACKUP_REQUIRED",
        "scope=core requires a pre-made backup_id — a fresh backup here does NOT capture core files (wp-admin/wp-includes), so a rollback could not restore them. Take a full backup first (rolepod_wp_site_backup) and pass its id.",
        {},
      );
    }
    backupId = input.backup_id;
    const ver = await target.wpCli(["core", "version"]);
    oldCoreVersion = ver.exitCode === 0 ? ver.stdout.trim() : "";
  } else {
    backupId = await backupAndWait(bridge, deadline());
  }

  // Update inside maintenance mode; deactivate ALWAYS (finally).
  let updated: string[] = [];
  try {
    await target.wpCli(["maintenance-mode", "activate"], {
      allowDestructive: true,
    });
    updated = await runUpdate(target, input);
  } finally {
    await target.wpCli(["maintenance-mode", "deactivate"], {
      allowDestructive: true,
    });
  }

  // Health probe (maintenance mode is off now).
  if (await probeHealthy(target)) {
    await recordChange(target, {
      category: "maintenance",
      subcategory: input.scope,
      targetDescriptor: `${input.scope} update (${updated.join(", ")})`,
      beforeState: {
        backup_id: backupId,
        core_version: oldCoreVersion || null,
      },
      afterState: { updated },
      // A core db upgrade + core files have no clean ledger undo; plugin/theme
      // are restorable from the backup but we mark reversible only for those.
      reversible: input.scope !== "core",
      sourceTool: "wp_maintenance_update",
      notes: `Rollback source: backup ${backupId}${input.scope === "core" ? ` (+ core pin ${oldCoreVersion})` : ""}.`,
    });
    return MaintenanceUpdateOutputSchema.parse({
      scope: input.scope,
      updated,
      backup_id: backupId,
      health_ok: true,
      rolled_back: false,
    });
  }

  // Unhealthy. Roll back if allowed, then RE-PROBE before claiming success.
  if (!input.auto_rollback) {
    return MaintenanceUpdateOutputSchema.parse({
      scope: input.scope,
      updated,
      backup_id: backupId,
      health_ok: false,
      rolled_back: false,
      reason: `post-update health check failed and auto_rollback=false — recover from backup ${backupId}`,
    });
  }

  try {
    if (input.scope === "core") {
      if (oldCoreVersion) {
        await target.wpCli(
          ["core", "update", `--version=${oldCoreVersion}`, "--force"],
          { allowDestructive: true },
        );
      }
      await restoreAndWait(
        bridge,
        backupId,
        { db: true, files: false },
        deadline(),
      );
    } else {
      await restoreAndWait(
        bridge,
        backupId,
        { db: true, files: true },
        deadline(),
      );
    }
  } catch (err) {
    return MaintenanceUpdateOutputSchema.parse({
      scope: input.scope,
      updated,
      backup_id: backupId,
      health_ok: false,
      rolled_back: false,
      reason: `post-update health failed AND rollback errored (${(err as Error).message}) — MANUAL recovery required from backup ${backupId}`,
    });
  }

  const healthyAfter = await probeHealthy(target);
  return MaintenanceUpdateOutputSchema.parse({
    scope: input.scope,
    updated,
    backup_id: backupId,
    health_ok: healthyAfter,
    rolled_back: healthyAfter,
    reason: healthyAfter
      ? `post-update health failed; rolled back to backup ${backupId} and re-verified green`
      : `post-update health failed; rollback ran but the site is STILL unhealthy — MANUAL recovery required from backup ${backupId}`,
  });
}
