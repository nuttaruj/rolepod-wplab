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
    "OPEN IT YOURSELF. Hand the URL to whatever browser automation you have — rolepod-uiproof `browser_open`, a Chrome-extension MCP, Playwright, Puppeteer — and keep working. WordPress sets the auth cookie on that browser context, so every later navigation in the same session stays signed in: you can audit wp-admin, read a settings screen, or reproduce an admin-only bug without the user logging in at all. Re-mint if the browser context is recreated; the token is single-use and dies after 5 minutes. " +
    "Asking a person to click the link is the LAST resort — only when no browser automation is available to you. " +
    "Security: whoever opens the URL holds a full admin session. Anything that records that browser (HAR, Playwright trace, video) captures the auth cookie with it, so treat those artifacts as credentials and do not share them.",
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
