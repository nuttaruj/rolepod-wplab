import type { Target } from "../../runtime/Target.js";

export interface WooWriteAPI {
  /** Update a single product via REST PUT /wc/v3/products/{id}. */
  updateProduct(
    target: Target,
    id: number,
    fields: Record<string, unknown>,
  ): Promise<unknown>;

  /** Bulk price update via REST batch endpoint. */
  bulkUpdatePrices(
    target: Target,
    updates: Array<{
      id: number;
      regular_price?: string | undefined;
      sale_price?: string | undefined;
    }>,
  ): Promise<{ updated: number; failed: number }>;

  /** Create an order via POST /wc/v3/orders. */
  createOrder(
    target: Target,
    fields: Record<string, unknown>,
  ): Promise<unknown>;

  /** Update an order's status via PUT /wc/v3/orders/{id}. */
  updateOrderStatus(
    target: Target,
    id: number,
    status: string,
  ): Promise<unknown>;

  /**
   * Create a refund via POST /wc/v3/orders/{id}/refunds. `api_refund` controls
   * whether the money actually goes back through the payment gateway.
   */
  createRefund(
    target: Target,
    orderId: number,
    args: { amount?: string; reason?: string; api_refund: boolean },
  ): Promise<unknown>;

  /** Create a coupon via POST /wc/v3/coupons. */
  createCoupon(
    target: Target,
    fields: Record<string, unknown>,
  ): Promise<unknown>;

  /** Create a product variation via POST /wc/v3/products/{id}/variations. */
  createVariation(
    target: Target,
    productId: number,
    fields: Record<string, unknown>,
  ): Promise<unknown>;
}

async function wcPost(
  target: Target,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const res = await target.rest({ method: "POST", path, body });
  if (res.status < 200 || res.status >= 300) {
    const rb = (res.body ?? {}) as { code?: string; message?: string };
    throw new Error(
      rb.message ?? `WC POST ${path} returned HTTP ${res.status}`,
    );
  }
  return res.body;
}

export const woocommerceWrite: WooWriteAPI = {
  async updateProduct(target, id, fields) {
    const res = await target.rest({
      method: "PUT",
      path: `/wc/v3/products/${id}`,
      body: fields,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WC product update returned HTTP ${res.status}`);
    }
    return res.body;
  },

  async bulkUpdatePrices(target, updates) {
    if (updates.length === 0) return { updated: 0, failed: 0 };
    const res = await target.rest({
      method: "POST",
      path: "/wc/v3/products/batch",
      body: { update: updates },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WC batch update returned HTTP ${res.status}`);
    }
    const body = (res.body ?? {}) as { update?: unknown[] };
    return {
      updated: Array.isArray(body.update) ? body.update.length : 0,
      failed:
        updates.length - (Array.isArray(body.update) ? body.update.length : 0),
    };
  },

  async createOrder(target, fields) {
    return wcPost(target, "/wc/v3/orders", fields);
  },

  async updateOrderStatus(target, id, status) {
    const res = await target.rest({
      method: "PUT",
      path: `/wc/v3/orders/${id}`,
      body: { status },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`WC order status update returned HTTP ${res.status}`);
    }
    return res.body;
  },

  async createRefund(target, orderId, args) {
    const body: Record<string, unknown> = { api_refund: args.api_refund };
    if (args.amount !== undefined) body["amount"] = args.amount;
    if (args.reason !== undefined) body["reason"] = args.reason;
    return wcPost(target, `/wc/v3/orders/${orderId}/refunds`, body);
  },

  async createCoupon(target, fields) {
    return wcPost(target, "/wc/v3/coupons", fields);
  },

  async createVariation(target, productId, fields) {
    return wcPost(target, `/wc/v3/products/${productId}/variations`, fields);
  },
};
