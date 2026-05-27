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
    "Mint a one-time wp-admin login URL on a connected target. The companion stores a 5-minute single-use transient; the URL form is `<siteurl>/?rolepod_wp_otl=<token>`. The AI surfaces the URL to the user — they click once and land in /wp-admin/ authenticated as the issuing admin (no password exposed). Browser-automation safe: paste URL into headless browser and proceed.",
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
