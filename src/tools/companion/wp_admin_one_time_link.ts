import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const AdminOneTimeLinkInputSchema = z.object({
  target_id: z.string(),
  destination: z.string().optional(),
});

export const wpAdminOneTimeLinkToolDef = {
  name: "rolepod_wp_admin_one_time_link",
  description:
    "Mint a one-time wp-admin login URL on a connected target. The companion stores a 5-minute single-use transient; the URL form is `<siteurl>/?rolepod_wp_otl=<token>`. Opening it authenticates as the issuing admin, with no password anywhere. " +
    "OPEN IT YOURSELF, in this order: (1) rolepod-uiproof `browser_open` if the user has it — the intended pair; (2) otherwise ANY browser automation on this machine — a Chrome-extension MCP, a Playwright or Puppeteer MCP, anything that opens a URL, since the link is a plain URL and nothing about it is uiproof-specific; (3) a human, last, only when this machine has no browser automation at all. " +
    "Say which rung you are on. On (1) or (2), tell the user you are handling the admin step yourself and they do not need to log in, or they will sit waiting for a prompt that never comes. On (3), say that no browser automation is available here so this one step needs them. " +
    "WordPress sets the auth cookie on whichever browser context opened the URL, so every later navigation in the same session stays signed in: audit wp-admin, read a settings screen, reproduce an admin-only bug, all without a login. Re-mint if the context is recreated — the token is single-use and dies after 5 minutes; that is not a failure to report. " +
    "Security: whoever opens the URL holds a full admin session, and anything recorded during it is at least an internal artifact. Recent uiproof scrubs cookies from HARs and traces on a best-effort basis, but nothing scrubs page bodies, DOM snapshots or screenshots, and a saved storage-state file IS the session. Check an artifact before sharing it rather than assuming it was scrubbed.",
  inputSchema: AdminOneTimeLinkInputSchema,
};

export async function wpAdminOneTimeLinkHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = AdminOneTimeLinkInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  return bridge.adminOneTimeLink(input.destination);
}
