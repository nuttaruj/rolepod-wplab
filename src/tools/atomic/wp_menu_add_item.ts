import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const MenuAddItemInputSchema = z.object({
  target_id: z.string(),
  menu_id: z.number().int().positive(),
  title: z.string().min(1),
  object_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Page/post id when type=post_type."),
  type: z.enum(["post_type", "custom"]).default("post_type"),
  object: z
    .string()
    .default("page")
    .describe("WP object type — 'page' or 'post' or any registered CPT."),
  url: z
    .string()
    .url()
    .optional()
    .describe("When type=custom, the URL to link to."),
  position: z.number().int().min(0).optional(),
});

export const wpMenuAddItemToolDef = {
  name: "rolepod_wp_menu_add_item",
  description:
    "Add an item to a nav menu (page link or custom URL). For pages: pass type='post_type', object='page', object_id=<page_id>. For external/custom URLs: type='custom', title + url. Auto-ledgered.",
  inputSchema: MenuAddItemInputSchema,
};

export async function wpMenuAddItemHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = MenuAddItemInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_menu_add_item requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  if (input.type === "post_type" && !input.object_id) {
    throw new WplabError("OBJECT_ID_REQUIRED", "object_id required when type=post_type", {});
  }
  if (input.type === "custom" && !input.url) {
    throw new WplabError("URL_REQUIRED", "url required when type=custom", {});
  }
  const bridge = await bridgeFor(target);
  const data: Record<string, unknown> = {
    "menu-item-title": input.title,
    "menu-item-type": input.type,
    "menu-item-status": "publish",
  };
  if (input.type === "post_type") {
    data["menu-item-object"] = input.object;
    data["menu-item-object-id"] = input.object_id;
  } else {
    data["menu-item-url"] = input.url;
  }
  if (input.position !== undefined) data["menu-item-position"] = input.position;

  const payload = `$item_id = wp_update_nav_menu_item(${input.menu_id}, 0, ${jsonToPhpArray(data)});
if (is_wp_error($item_id)) return ['error' => 'ADD_ITEM_FAILED', 'detail' => $item_id->get_error_message()];
return ['item_id' => (int) $item_id, 'menu_id' => ${input.menu_id}];`;
  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "MENU_ADD_ITEM_FAILED",
      result.error_message ?? "wp_menu_add_item execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as { item_id?: number; error?: string; detail?: string };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, { input });
  }
  await recordChange(target, {
    category: "layout",
    subcategory: `nav-menu-item:${input.menu_id}:${input.title}`,
    targetDescriptor: `menu item "${input.title}" added to menu ${input.menu_id}`,
    beforeState: null,
    afterState: { item_id: rv.item_id, menu_id: input.menu_id, title: input.title },
    reversible: true,
    sourceTool: "wp_menu_add_item",
  });
  return { item_id: rv.item_id, menu_id: input.menu_id };
}

function jsonToPhpArray(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj)
    .map(([k, v]) => `${JSON.stringify(k)} => ${phpValue(v)}`)
    .join(", ");
  return `[${entries}]`;
}

function phpValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(JSON.stringify(v));
}
