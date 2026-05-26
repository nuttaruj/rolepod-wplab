import { openTarget } from "../../runtime/factory.js";
import { makeVault } from "../../credentials/factory.js";
import { canonicalizeSite } from "../../credentials/types.js";
import { WplabError } from "../../util/errors.js";
import {
  COMPANION_INSTALL_URL,
  setupWizardUrlFor,
} from "../../companion/constants.js";
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
        `Two paths to pair this site:`,
        ``,
        `  (A) RECOMMENDED — one-click pair via companion:`,
        `      1. Install the companion plugin on the WP site:`,
        `         wp plugin install ${COMPANION_INSTALL_URL} --activate`,
        `         (or upload via wp-admin → Plugins → Add New → Upload)`,
        `      2. Open ${setupWizardUrl}`,
        `      3. Click "Generate setup prompt" + paste the prompt back here`,
        `      4. I'll call rolepod_wp_pair with the token automatically`,
        ``,
        `  (B) Manual — store an App Password locally:`,
        `      Run on the user's machine:`,
        `        rolepod-wplab credentials add ${lookupKey}`,
        `      Then retry rolepod_wp_connect_rest.`,
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

  registry.register(target);
  await vault.touch(lookupKey);

  return ConnectRestOutputSchema.parse({
    target_id: target.id,
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
  });
}
