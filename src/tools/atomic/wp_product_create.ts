import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ProductCreateInputSchema = z.object({
  target_id: z.string(),
  name: z.string().min(1),
  regular_price: z
    .string()
    .describe("Price as a decimal string, e.g. '650.00'."),
  short_description: z.string().optional(),
  description: z.string().optional(),
  sku: z.string().optional(),
  stock: z.number().int().min(0).optional(),
  category_ids: z.array(z.number().int().positive()).optional(),
  status: z.enum(["publish", "draft", "pending", "private"]).default("publish"),
  confirm: z.boolean().default(false),
});

export const wpProductCreateToolDef = {
  name: "rolepod_wp_product_create",
  description:
    "Create a simple WooCommerce product through the WooCommerce REST CRUD API (POST /wc/v3/products) — NOT raw postmeta, so WC's own hooks, stock-status derivation, and lookup tables stay consistent. Sets regular_price, sku, stock, descriptions, categories. A duplicate SKU is surfaced as product_invalid_sku. Needs a rest target with WooCommerce active (Application Password user with manage_woocommerce). Production writes need confirm=true. Auto-ledgered.",
  inputSchema: ProductCreateInputSchema,
};

export async function wpProductCreateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<unknown> {
  const input = ProductCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "product_create blocked on production-matched target — pass confirm=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  const body: Record<string, unknown> = {
    name: input.name,
    type: "simple",
    regular_price: input.regular_price,
    status: input.status,
  };
  if (input.description !== undefined) body["description"] = input.description;
  if (input.short_description !== undefined)
    body["short_description"] = input.short_description;
  if (input.sku !== undefined) body["sku"] = input.sku;
  if (input.stock !== undefined) {
    body["manage_stock"] = true;
    body["stock_quantity"] = input.stock;
    // WC derives stock_status from manage_stock + quantity (0 → outofstock).
  }
  if (input.category_ids && input.category_ids.length > 0) {
    body["categories"] = input.category_ids.map((id) => ({ id }));
  }

  const res = await target.rest({
    method: "POST",
    path: "/wc/v3/products",
    body,
  });

  const rb = (res.body ?? {}) as {
    id?: number;
    permalink?: string;
    code?: string;
    message?: string;
  };
  if (res.status < 200 || res.status >= 300) {
    // WC returns e.g. { code: "product_invalid_sku", message: "...", data:{status:400} }
    throw new WplabError(
      rb.code ?? "PRODUCT_CREATE_FAILED",
      rb.message ?? `WC product create returned HTTP ${res.status}`,
      { status: res.status, body: res.body },
    );
  }
  if (typeof rb.id !== "number") {
    throw new WplabError(
      "PRODUCT_CREATE_NO_ID",
      "WC product create returned no product id",
      { body: res.body },
    );
  }

  await recordChange(target, {
    category: "post",
    subcategory: `product:${rb.id}`,
    targetDescriptor: `WC product "${input.name}" created`,
    beforeState: { existed: false },
    afterState: {
      product_id: rb.id,
      name: input.name,
      price: input.regular_price,
    },
    reversible: true,
    sourceTool: "wp_product_create",
  });

  return {
    product_id: rb.id,
    name: input.name,
    ...(rb.permalink !== undefined ? { permalink: rb.permalink } : {}),
  };
}
