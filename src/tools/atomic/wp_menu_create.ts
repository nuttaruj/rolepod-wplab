import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { phpQuote } from "../../lib/phpEmbed.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const MenuCreateInputSchema = z.object({
  target_id: z.string(),
  name: z.string().min(1).describe("Display name of the nav menu."),
  reuse_existing: z
    .boolean()
    .default(true)
    .describe(
      "If a menu with this name already exists, return its id instead of failing. Default true.",
    ),
});

export const wpMenuCreateToolDef = {
  name: "rolepod_wp_menu_create",
  description:
    "Create (or reuse) a WordPress nav menu by display name. Returns the term_id used by add-item + assign tools. Idempotent when reuse_existing=true.",
  inputSchema: MenuCreateInputSchema,
};

export async function wpMenuCreateHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = MenuCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_menu_create requires the rolepod-wp companion (uses execute-php for nav menu APIs).",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);
  const nameJson = phpQuote(input.name);
  const payload = `$existing = wp_get_nav_menu_object(${nameJson});
if ($existing && ${input.reuse_existing ? "true" : "false"}) {
  return ['menu_id' => (int) $existing->term_id, 'created' => false, 'name' => ${nameJson}];
}
if ($existing) {
  return ['error' => 'MENU_EXISTS', 'menu_id' => (int) $existing->term_id, 'name' => ${nameJson}];
}
$id = wp_create_nav_menu(${nameJson});
if (is_wp_error($id)) return ['error' => 'CREATE_FAILED', 'detail' => $id->get_error_message()];
return ['menu_id' => (int) $id, 'created' => true, 'name' => ${nameJson}];`;
  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "MENU_CREATE_FAILED",
      result.error_message ?? "wp_menu_create execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    menu_id?: number;
    created?: boolean;
    name?: string;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, { name: input.name });
  }
  if (rv.created) {
    await recordChange(target, {
      category: "layout",
      subcategory: `nav-menu:${input.name}`,
      targetDescriptor: `nav menu "${input.name}" created`,
      beforeState: null,
      afterState: { menu_id: rv.menu_id, name: rv.name },
      // A nav menu is a taxonomy term, not post meta. The companion's `layout`
      // dispatcher restores post meta, so it cannot delete this term — a
      // "revert" would be a silent no-op. Record it for visibility, honestly.
      reversible: false,
      notes: `To undo: delete the "${rv.name}" nav menu (term id ${rv.menu_id}) from Appearance → Menus, or wp menu delete ${rv.menu_id}.`,
      sourceTool: "wp_menu_create",
    });
  }
  return { menu_id: rv.menu_id, created: rv.created, name: rv.name };
}
