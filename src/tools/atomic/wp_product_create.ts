import { z } from "zod";
import { bridgeFor } from "../../companion/Bridge.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ProductCreateInputSchema = z.object({
  target_id: z.string(),
  name: z.string().min(1),
  regular_price: z.string().describe("Price as a decimal string, e.g. '650.00'."),
  short_description: z.string().optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  stock: z.number().int().min(0).optional(),
  category_ids: z.array(z.number().int().positive()).optional(),
  status: z.enum(["publish", "draft", "pending", "private"]).default("publish"),
});

export const wpProductCreateToolDef = {
  name: "rolepod_wp_product_create",
  description:
    "Create a WooCommerce simple product. Refuses if WooCommerce is not active. Sets regular_price, sku, stock, short/long description, categories. Auto-ledgered.",
  inputSchema: ProductCreateInputSchema,
};

export async function wpProductCreateHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ProductCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (!target.companion?.enabled) {
    throw new WplabError(
      "COMPANION_REQUIRED",
      "wp_product_create requires the rolepod-wp companion.",
      { targetId: input.target_id },
    );
  }
  const bridge = await bridgeFor(target);

  const payload = `if (!class_exists('WooCommerce')) {
  return ['error' => 'WOOCOMMERCE_NOT_ACTIVE', 'detail' => 'Install + activate WooCommerce before using wp_product_create.'];
}
$args = [
  'post_title' => ${JSON.stringify(input.name)},
  'post_status' => ${JSON.stringify(input.status)},
  'post_type' => 'product',
];
${input.description !== undefined ? `$args['post_content'] = ${JSON.stringify(input.description)};` : ""}
${input.short_description !== undefined ? `$args['post_excerpt'] = ${JSON.stringify(input.short_description)};` : ""}
$post_id = wp_insert_post($args);
if (is_wp_error($post_id)) return ['error' => 'INSERT_FAILED', 'detail' => $post_id->get_error_message()];
update_post_meta($post_id, '_regular_price', ${JSON.stringify(input.regular_price)});
update_post_meta($post_id, '_price', ${JSON.stringify(input.regular_price)});
${input.sku !== undefined ? `update_post_meta($post_id, '_sku', ${JSON.stringify(input.sku)});` : ""}
${
  input.stock !== undefined
    ? `update_post_meta($post_id, '_manage_stock', 'yes');
update_post_meta($post_id, '_stock', ${input.stock});
update_post_meta($post_id, '_stock_status', 'instock');`
    : ""
}
update_post_meta($post_id, '_virtual', 'no');
update_post_meta($post_id, '_downloadable', 'no');
wp_set_object_terms($post_id, 'simple', 'product_type');
${
  input.category_ids && input.category_ids.length > 0
    ? `wp_set_object_terms($post_id, [${input.category_ids.join(",")}], 'product_cat');`
    : ""
}
return ['product_id' => (int) $post_id, 'name' => ${JSON.stringify(input.name)}, 'permalink' => get_permalink($post_id)];`;

  const result = await bridge.executePhp(payload);
  if (!result.ok) {
    throw new WplabError(
      result.error_code ?? "PRODUCT_CREATE_FAILED",
      result.error_message ?? "wp_product_create execute-php failed",
      { result },
    );
  }
  const rv = (result.return_value ?? {}) as {
    product_id?: number;
    permalink?: string;
    error?: string;
    detail?: string;
  };
  if (rv.error) {
    throw new WplabError(rv.error, rv.detail ?? rv.error, { input });
  }
  await recordChange(target, {
    category: "post",
    subcategory: `product:${rv.product_id}`,
    targetDescriptor: `WC product "${input.name}" created`,
    beforeState: null,
    afterState: { product_id: rv.product_id, name: input.name, price: input.regular_price },
    reversible: true,
    sourceTool: "wp_product_create",
  });
  return rv;
}
