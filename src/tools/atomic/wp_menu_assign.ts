import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const MenuAssignInputSchema = z.object({
  target_id: z.string(),
  menu_id: z.number().int().positive(),
  location: z
    .string()
    .min(1)
    .describe(
      "Theme location slug — typically 'primary' or 'footer'. Check theme's register_nav_menus() for available slugs.",
    ),
});

export const wpMenuAssignToolDef = {
  name: "rolepod_wp_menu_assign",
  description:
    "Assign a nav menu to a theme location (e.g. 'primary'). Updates the theme_mod 'nav_menu_locations' array. Auto-ledgered.",
  inputSchema: MenuAssignInputSchema,
};

export async function wpMenuAssignHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = MenuAssignInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_menu_assign requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);
  const locJson = JSON.stringify(input.location);
  const payload = `$locations = (array) get_theme_mod('nav_menu_locations', []);
$prev = isset($locations[${locJson}]) ? $locations[${locJson}] : null;
$locations[${locJson}] = ${input.menu_id};
set_theme_mod('nav_menu_locations', $locations);
return ['location' => ${locJson}, 'menu_id' => ${input.menu_id}, 'previous_menu_id' => $prev];`;
  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "MENU_ASSIGN_FAILED",
      result.error_message ?? "wp_menu_assign execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as { previous_menu_id?: number | null };
  await recordChange(target, {
    category: "layout",
    subcategory: `nav-menu-location:${input.location}`,
    targetDescriptor: `assigned menu ${input.menu_id} to theme location "${input.location}"`,
    beforeState: { menu_id: rv.previous_menu_id ?? null },
    afterState: { menu_id: input.menu_id },
    reversible: true,
    sourceTool: "wp_menu_assign",
  });
  return rv;
}
