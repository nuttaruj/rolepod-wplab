import { woocommerceAdapter } from "../../adapters/woocommerce/read.js";
import { woocommerceWrite } from "../../adapters/woocommerce/write.js";
import { recordChange } from "../../companion/ledger.js";
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
    "WooCommerce write operations via WC REST CRUD: update_product · bulk_update_prices · create_order · update_order_status · create_refund · create_coupon · create_variation. Every op is ledgered. MONEY SAFETY: create_refund defaults api_refund=false (records the refund in WooCommerce but sends NO money through the gateway); setting api_refund=true issues a real gateway refund and additionally requires confirm=true (MONEY_OP_NEEDS_CONFIRM). Requires allow_destructive=true. Production guard fires unless confirm=true.",
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
    // Visibility only: the WC REST PUT does not return the prior values, so we
    // cannot revert. Record what changed with reversible:false.
    await recordChange(target, {
      category: "post",
      subcategory: `product:${input.product_id}`,
      targetDescriptor: `WooCommerce product ${input.product_id} updated`,
      afterState: { fields: input.fields },
      reversible: false,
      notes:
        "WooCommerce writes go through the WC REST API, which does not return the prior values — this change cannot be reverted from the ledger. Note the previous values before editing if you may need to roll back.",
      sourceTool: "rolepod_wp_woo_write",
    });
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
    await recordChange(target, {
      category: "post",
      subcategory: "bulk_prices",
      targetDescriptor: `WooCommerce bulk price update — ${input.price_updates.length} product(s)`,
      afterState: { price_updates: input.price_updates },
      reversible: false,
      notes:
        "Bulk price update via the WC REST batch endpoint — prior prices were not captured and cannot be reverted from the ledger.",
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  if (input.op === "create_order") {
    if (input.fields === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "create_order requires fields (the order payload)",
        {},
      );
    }
    const result = await woocommerceWrite.createOrder(target, input.fields);
    const orderId = (result as { id?: number })?.id;
    await recordChange(target, {
      category: "post",
      subcategory: `order:${orderId ?? "new"}`,
      targetDescriptor: `WooCommerce order ${orderId ?? ""} created`,
      afterState: { order_id: orderId, fields: input.fields },
      reversible: false,
      notes:
        "Order created via WC REST. Cancel/refund it through WooCommerce rather than reverting from the ledger.",
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  if (input.op === "update_order_status") {
    if (input.order_id === undefined || input.order_status === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "update_order_status requires order_id + order_status",
        {},
      );
    }
    const result = await woocommerceWrite.updateOrderStatus(
      target,
      input.order_id,
      input.order_status,
    );
    await recordChange(target, {
      category: "post",
      subcategory: `order:${input.order_id}`,
      targetDescriptor: `WooCommerce order ${input.order_id} → ${input.order_status}`,
      afterState: { order_id: input.order_id, status: input.order_status },
      reversible: false,
      notes:
        "Order status changed via WC REST — the prior status was not captured; re-set it explicitly to roll back.",
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  if (input.op === "create_refund") {
    if (input.order_id === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "create_refund requires order_id",
        {},
      );
    }
    // MONEY GATE: sending the refund back through the gateway is irreversible
    // and moves real money — require an explicit confirm on top of api_refund.
    if (input.api_refund && !input.confirm) {
      throw new WplabError(
        "MONEY_OP_NEEDS_CONFIRM",
        "api_refund=true issues a real gateway refund (money leaves the account) — pass confirm=true to proceed, or omit api_refund to record a refund in WooCommerce WITHOUT touching the gateway",
        { order_id: input.order_id, refund_amount: input.refund_amount },
      );
    }
    const result = await woocommerceWrite.createRefund(target, input.order_id, {
      ...(input.refund_amount !== undefined
        ? { amount: input.refund_amount }
        : {}),
      ...(input.refund_reason !== undefined
        ? { reason: input.refund_reason }
        : {}),
      api_refund: input.api_refund,
    });
    await recordChange(target, {
      category: "post",
      subcategory: `refund:order:${input.order_id}`,
      targetDescriptor: `WooCommerce refund on order ${input.order_id}${input.api_refund ? " (gateway)" : " (record-only)"}`,
      afterState: {
        order_id: input.order_id,
        amount: input.refund_amount ?? null,
        api_refund: input.api_refund,
      },
      reversible: false,
      notes: input.api_refund
        ? "Gateway refund issued — irreversible; money left the account."
        : "Refund recorded in WooCommerce only (api_refund=false) — no gateway movement.",
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  if (input.op === "create_coupon") {
    if (input.coupon === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "create_coupon requires coupon (the coupon payload, e.g. { code, discount_type, amount })",
        {},
      );
    }
    const result = await woocommerceWrite.createCoupon(target, input.coupon);
    const couponId = (result as { id?: number })?.id;
    await recordChange(target, {
      category: "post",
      subcategory: `coupon:${couponId ?? "new"}`,
      targetDescriptor: `WooCommerce coupon ${couponId ?? ""} created`,
      afterState: { coupon_id: couponId, coupon: input.coupon },
      reversible: false,
      notes: "Coupon created via WC REST — delete it in WooCommerce to remove.",
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  if (input.op === "create_variation") {
    if (input.product_id === undefined || input.variation === undefined) {
      throw new WplabError(
        "WOO_WRITE_BAD_INPUT",
        "create_variation requires product_id + variation",
        {},
      );
    }
    const result = await woocommerceWrite.createVariation(
      target,
      input.product_id,
      input.variation,
    );
    const variationId = (result as { id?: number })?.id;
    await recordChange(target, {
      category: "post",
      subcategory: `variation:product:${input.product_id}`,
      targetDescriptor: `WooCommerce variation ${variationId ?? ""} on product ${input.product_id}`,
      afterState: {
        product_id: input.product_id,
        variation_id: variationId,
        variation: input.variation,
      },
      reversible: false,
      sourceTool: "rolepod_wp_woo_write",
    });
    return WooWriteOutputSchema.parse({ op: input.op, result });
  }

  // exhaustive
  throw new WplabError(
    "WOO_WRITE_UNKNOWN_OP",
    `Unknown op: ${String(input.op)}`,
    {},
  );
}
