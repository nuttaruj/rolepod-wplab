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
};
