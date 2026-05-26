import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import { log } from "../../util/log.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ThemeSwitchSafeInputSchema = z.object({
  target_id: z.string(),
  new_stylesheet: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  confirm_production: z.boolean().default(false),
});

export const wpThemeSwitchSafeToolDef = {
  name: "rolepod_wp_theme_switch_safe",
  description:
    "Safely switch the active theme: snapshot the CURRENT theme dir (tar.gz under wp-content/uploads/rolepod-wp-theme-snapshots/), wp-cli theme activate <new_stylesheet>, post-switch health check, AUTO-ROLLBACK (restore the snapshot + reactivate the old theme) if health turns red. Records the swap as a ledger row category=theme so the user can also revert manually via Change Ledger.",
  inputSchema: ThemeSwitchSafeInputSchema,
};

export async function wpThemeSwitchSafeHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<{
  old_stylesheet: string;
  new_stylesheet: string;
  snapshot_path: string;
  switched: boolean;
  rolled_back: boolean;
  reason?: string;
}> {
  const input = ThemeSwitchSafeInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm_production) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      `theme switch blocked on production-matched target — pass confirm_production=true to proceed`,
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  // 1. Resolve current active stylesheet via wp-cli.
  const current = await target.wpCli(["theme", "list", "--status=active", "--field=name"]);
  if (current.exitCode !== 0) {
    throw new WplabError(
      "THEME_SWITCH_PROBE_FAILED",
      `cannot list active theme: ${current.stderr || current.stdout}`,
      { exitCode: current.exitCode },
    );
  }
  const oldStylesheet = current.stdout.trim().split(/\s+/)[0];
  if (!oldStylesheet) {
    throw new WplabError(
      "THEME_SWITCH_NO_CURRENT",
      `wp theme list returned no active theme`,
      { stdout: current.stdout },
    );
  }

  // 2. Verify new theme exists.
  const newCheck = await target.wpCli([
    "theme",
    "is-installed",
    input.new_stylesheet,
  ]);
  if (newCheck.exitCode !== 0) {
    throw new WplabError(
      "THEME_SWITCH_NEW_NOT_INSTALLED",
      `new theme '${input.new_stylesheet}' is not installed on this site`,
      { exitCode: newCheck.exitCode, new_stylesheet: input.new_stylesheet },
    );
  }

  // 3. Snapshot the current theme dir.
  const bridge = await bridgeFor(target);
  const snapshot = await bridge.themeSnapshot(oldStylesheet);
  log.info("theme switch: snapshot of current theme", {
    stylesheet: oldStylesheet,
    path: snapshot.path,
    bytes: snapshot.bytes,
  });

  // 4. Activate new theme.
  const activate = await target.wpCli(
    ["theme", "activate", input.new_stylesheet],
    { allowDestructive: true },
  );
  if (activate.exitCode !== 0) {
    return {
      old_stylesheet: oldStylesheet,
      new_stylesheet: input.new_stylesheet,
      snapshot_path: snapshot.path,
      switched: false,
      rolled_back: false,
      reason: `wp-cli theme activate failed: ${activate.stderr || activate.stdout}`,
    };
  }

  // 5. Post-switch health check. If REST probe fails (white page on frontend
  //    likely follows), auto-rollback.
  let healthOk = true;
  try {
    const healthProbe = await target.rest({ method: "GET", path: "/" });
    if (healthProbe.status < 200 || healthProbe.status >= 400) {
      healthOk = false;
    }
  } catch (err) {
    log.warn("theme switch: post-switch REST probe threw", {
      err: (err as Error).message,
    });
    healthOk = false;
  }

  if (!healthOk) {
    log.warn("theme switch: post-switch unhealthy → auto-rollback", {
      from: input.new_stylesheet,
      to: oldStylesheet,
    });
    await target.wpCli(["theme", "activate", oldStylesheet], {
      allowDestructive: true,
    });
    await bridge.themeRestore(snapshot.path);
    return {
      old_stylesheet: oldStylesheet,
      new_stylesheet: input.new_stylesheet,
      snapshot_path: snapshot.path,
      switched: false,
      rolled_back: true,
      reason: "post-switch health check failed; old theme + snapshot restored",
    };
  }

  // 6. Record ledger row for manual revert later.
  await recordChange(target, {
    category: "theme",
    subcategory: "switch",
    targetDescriptor: `switch theme ${oldStylesheet} → ${input.new_stylesheet}`,
    beforeState: {
      stylesheet: oldStylesheet,
      snapshot_path: snapshot.path,
    },
    afterState: {
      stylesheet: input.new_stylesheet,
    },
    reversible: true,
    sourceTool: "wp_theme_switch_safe",
  });

  return {
    old_stylesheet: oldStylesheet,
    new_stylesheet: input.new_stylesheet,
    snapshot_path: snapshot.path,
    switched: true,
    rolled_back: false,
  };
}
