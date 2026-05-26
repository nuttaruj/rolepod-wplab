import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface WooReadAPI {
  /** List products via WooCommerce REST `/wc/v3/products`. */
  products(
    target: Target,
    opts?: { per_page?: number; search?: string },
  ): Promise<unknown[]>;

  /** List orders (read-only) via `/wc/v3/orders`. */
  orders(
    target: Target,
    opts?: { per_page?: number; status?: string },
  ): Promise<unknown[]>;

  /** Top-level settings — payment / shipping / tax / general groups. */
  settingsGroups(target: Target): Promise<unknown[]>;

  /** Settings entries for one group. */
  settingsInGroup(target: Target, group: string): Promise<unknown[]>;

  /** Shipping zones. */
  shippingZones(target: Target): Promise<unknown[]>;

  /** Active payment gateways summary. */
  paymentGateways(target: Target): Promise<unknown[]>;
}

const SLUG = "woocommerce";

export const woocommerceAdapter: Adapter<WooReadAPI> = {
  slug: SLUG,
  name: "WooCommerce",
  supportedRange: { min: "8.0", testedUpTo: "9.4" },

  async detect(target: Target): Promise<boolean> {
    // WooCommerce registers /wc/v3/ — probe REST routes index.
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        return Object.keys(body.routes).some((r) => r.startsWith("/wc/v3"));
      }
    } catch {
      // fall through
    }
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli(["plugin", "is-active", "woocommerce"]);
        return r.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  },

  read: {
    async products(target, opts = {}) {
      const query: Record<string, string | number | boolean> = {
        per_page: opts.per_page ?? 20,
      };
      if (opts.search !== undefined) query["search"] = opts.search;
      const res = await target.rest({
        method: "GET",
        path: "/wc/v3/products",
        query,
      });
      return Array.isArray(res.body) ? res.body : [];
    },

    async orders(target, opts = {}) {
      const query: Record<string, string | number | boolean> = {
        per_page: opts.per_page ?? 20,
      };
      if (opts.status !== undefined) query["status"] = opts.status;
      const res = await target.rest({
        method: "GET",
        path: "/wc/v3/orders",
        query,
      });
      return Array.isArray(res.body) ? res.body : [];
    },

    async settingsGroups(target) {
      const res = await target.rest({ method: "GET", path: "/wc/v3/settings" });
      return Array.isArray(res.body) ? res.body : [];
    },

    async settingsInGroup(target, group) {
      const res = await target.rest({
        method: "GET",
        path: `/wc/v3/settings/${encodeURIComponent(group)}`,
      });
      return Array.isArray(res.body) ? res.body : [];
    },

    async shippingZones(target) {
      const res = await target.rest({
        method: "GET",
        path: "/wc/v3/shipping/zones",
      });
      return Array.isArray(res.body) ? res.body : [];
    },

    async paymentGateways(target) {
      const res = await target.rest({
        method: "GET",
        path: "/wc/v3/payment_gateways",
      });
      return Array.isArray(res.body) ? res.body : [];
    },
  },
};
