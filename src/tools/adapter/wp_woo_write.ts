import { woocommerceAdapter } from "../../adapters/woocommerce/read.js";
import { woocommerceWrite } from "../../adapters/woocommerce/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  WooWriteInputSchema,
  WooWriteOutputSchema,
  type WooWriteInput,
  type WooWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpWooWriteToolDef = {
  name: "rolepod_wp_woo_write",
  description:
    "WooCommerce write operations: update_product (single product update via /wc/v3/products/{id}) or bulk_update_prices (batch via /wc/v3/products/batch). Requires allow_destructive=true. Production guard fires unless confirm=true.",
  inputSchema: WooWriteInputSchema,
};

export async function wpWooWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WooWriteOutput> {
  const input: WooWriteInput = WooWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "woo_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await woocommerceAdapter.detect(target))) {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "WooCommerce not active on target",
      {
        targetId: input.target_id,
      },
    );
  }

  if (input.op === "update_product") {
    if (input.product_id === undefined || input.fields === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "update_product requires product_id + fields",
        {},
      );
    }
    const result = await woocommerceWrite.updateProduct(
      target,
      input.product_id,
      input.fields,
    );
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }
  if (input.op === "bulk_update_prices") {
    if (!input.price_updates || input.price_updates.length === 0) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "bulk_update_prices requires non-empty price_updates",
        {},
      );
    }
    const result = await woocommerceWrite.bulkUpdatePrices(
      target,
      input.price_updates,
    );
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  // exhaustive
  throw new WplabError(
    "WOO_WRITE_UNKNOWN_OP",
    `Unknown op: ${String(input.op)}`,
    {},
  );
}
