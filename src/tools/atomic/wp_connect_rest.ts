import { openTarget } from "../../runtime/factory.js";
import { makeVault } from "../../credentials/factory.js";
import { canonicalizeSite } from "../../credentials/types.js";
import { WplabError } from "../../util/errors.js";
import {
  COMPANION_INSTALL_URL,
  setupWizardUrlFor,
} from "../../companion/constants.js";
import { collectConnectWarnings } from "../../lib/connectWarnings.js";
import {
  ConnectRestInputSchema,
  ConnectRestOutputSchema,
  type ConnectRestInput,
  type ConnectRestOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpConnectRestToolDef = {
  name: "rolepod_wp_connect_rest",
  description:
    "Open a remote WordPress target over HTTPS + REST. Resolves credentials from the credential vault by canonical hostname of the url. Refuses non-https URLs. Companion is optional but probed at connect; if absent, power tools + wpCli + file ops are unavailable on this target.",
  inputSchema: ConnectRestInputSchema,
};

export async function wpConnectRestHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<ConnectRestOutput> {
  const input: ConnectRestInput = ConnectRestInputSchema.parse(raw);
  const lookupKey = input.credential_ref ?? canonicalizeSite(input.url);

  const vault = await makeVault();
  const cred = await vault.get(lookupKey);
  if (!cred) {
    const setupWizardUrl = setupWizardUrlFor(input.url);
    throw new WplabError(
      "CREDENTIALS_MISSING",
      [
        `No credentials stored for ${lookupKey}.`,
        ``,
        `First time on this site? Lead the user through the plugin — do not`,
        `ask them to create credentials by hand:`,
        ``,
        `  (A) One-click pair via the Rolepod for WordPress plugin:`,
        `      1. Install the plugin (stable URL, always latest):`,
        `         ${COMPANION_INSTALL_URL}`,
        `         (wp-admin → Plugins → Add New → Upload Plugin → Activate,`,
        `          or: wp plugin install ${COMPANION_INSTALL_URL} --activate)`,
        `      2. Open ${setupWizardUrl}`,
        `      3. Quick start → Generate pair token → paste the prompt block here`,
        `      4. I'll call rolepod_wp_pair with the token — it mints and stores`,
        `         the Application Password automatically`,
        ``,
        `  (B) LAST RESORT — manual App Password. Only when the plugin cannot be`,
        `      installed (no plugin-install rights, host blocks uploads) or the`,
        `      user explicitly declines it:`,
        `        wp-admin → Users → Profile → Application Passwords → create one,`,
        `        then run on the user's machine:`,
        `          rolepod-wplab credentials add ${lookupKey}`,
        `        Then retry rolepod_wp_connect_rest.`,
      ].join("\n"),
      {
        site: lookupKey,
        setup_wizard_url: setupWizardUrl,
        companion_install_url: COMPANION_INSTALL_URL,
      },
    );
  }

  const target = await openTarget({
    kind: "rest",
    url: input.url,
    credential: cred,
  });

  if (input.require_companion && !target.companion) {
    await target.close();
    throw new WplabError(
      "COMPANION_REQUIRED_BUT_MISSING",
      [
        `Companion not detected on ${lookupKey} but require_companion=true.`,
        `Install the Rolepod for WordPress plugin on this WP install:`,
        `  wp plugin install ${COMPANION_INSTALL_URL} --activate`,
        `(or upload via wp-admin → Plugins → Add New → Upload)`,
      ].join("\n"),
      {
        site: lookupKey,
        companion_install_url: COMPANION_INSTALL_URL,
      },
    );
  }

  // The companion knows the owner's access mode; a target without one falls
  // back to the legacy probe (WP_ENVIRONMENT_TYPE + ROLEPOD_WPLAB_PROD_HOSTS).
  const prodGuard = await registry.register(target, {
    ...(target.companion?.accessMode !== undefined
      ? { accessMode: target.companion.accessMode }
      : {}),
  });
  await vault.touch(lookupKey);

  // Surface the active MCP-server profile (default | power) so AI clients
  // know whether wp_execute_php is currently unlocked. Power profile is
  // opt-in via env var ROLEPOD_WPLAB_PROFILE=power in MCP client config.
  const { loadProfile } = await import("../../profile/load.js");
  const profile = loadProfile();

  // Non-fatal config drift detection (siteurl mismatch, etc).
  const warnings = await collectConnectWarnings(target, input.url);

  return ConnectRestOutputSchema.parse({
    target_id: target.id,
    ...(prodGuard ? { prod_guard: prodGuard } : {}),
    siteurl: target.siteurl,
    wp_version: target.wpVersion,
    ...(target.phpVersion !== undefined
      ? { php_version: target.phpVersion }
      : {}),
    companion: target.companion
      ? {
          installed: target.companion.installed,
          enabled: target.companion.enabled,
          version: target.companion.version,
          capabilities: [...target.companion.capabilities],
        }
      : null,
    profile: {
      active: profile.profile,
      execute_php_unlocked: profile.profile === "power",
      env_var_name: "ROLEPOD_WPLAB_PROFILE",
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  });
}
