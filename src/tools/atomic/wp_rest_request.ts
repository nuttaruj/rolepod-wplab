import { recordChange } from "../../companion/ledger.js";
import { flushObjectCache } from "../../companion/cacheFlush.js";
import { WplabError } from "../../util/errors.js";
import {
  RestRequestInputSchema,
  RestRequestOutputSchema,
  type RestRequestInput,
  type RestRequestOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRestRequestToolDef = {
  name: "rolepod_wp_rest_request",
  description:
    "Generic authenticated REST passthrough. Useful when no dedicated tool covers a specific endpoint (e.g. plugin-published custom routes). Uses the same auth + URL form fallback as RestTarget. Writes to /wp/v2/global-styles/<id> are auto-ledgered + auto-cache-flushed. SEALED: write methods to WooCommerce money endpoints (/wc/v1|v2|v3 orders / refunds / coupons) are refused (WC_MONEY_ENDPOINT_BLOCKED) — a raw refund POST defaults to api_refund=true and moves real money at the gateway. Use rolepod_wp_woo_write (create_refund / create_order / update_order_status / create_coupon) which defaults api_refund=false and ledgers the change.",
  inputSchema: RestRequestInputSchema,
};

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * True when a write is aimed at a WooCommerce money endpoint. Path is normalized
 * first (leading slashes stripped, lowercased) so `/wc/v3/...`, `wc/v3/...`, and
 * `/WC/V3/...` all match, and nested refund routes (orders/{id}/refunds) are
 * caught too.
 */
export function isMoneyEndpointWrite(method: string, path: string): boolean {
  if (!WRITE_METHODS.has(method)) return false;
  const np = path.replace(/^\/+/, "").toLowerCase();
  if (!/^wc\/v[123]\//.test(np)) return false;
  return /(^|\/)(orders|refunds|coupons)(\/|$|\?)/.test(np);
}

export async function wpRestRequestHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<RestRequestOutput> {
  const input: RestRequestInput = RestRequestInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // Money seal: refuse raw writes to WC orders/refunds/coupons. These move money
  // (a raw refund POST defaults api_refund=true) and must go through the
  // dedicated, ledgered, confirm-gated woo_write ops instead.
  if (isMoneyEndpointWrite(input.method, input.path)) {
    throw new WplabError(
      "WC_MONEY_ENDPOINT_BLOCKED",
      `refusing a raw ${input.method} to a WooCommerce money endpoint (${input.path}) — use rolepod_wp_woo_write (create_refund / create_order / update_order_status / create_coupon), which defaults api_refund=false, gates money ops behind confirm, and ledgers the change`,
      { method: input.method, path: input.path },
    );
  }

  // Detect global-styles write. WP exposes one wp_global_styles post per theme;
  // its REST path is /wp/v2/global-styles/<id> with method POST|PUT|PATCH for
  // updates. Capture before-state via a GET first so the Change Ledger can
  // restore the prior `styles` / `settings` payload on toggle.
  const isGlobalStylesWrite =
    /^\/wp\/v2\/global-styles\/\d+(\/|$)/.test(input.path) &&
    (input.method === "POST" ||
      input.method === "PUT" ||
      input.method === "PATCH");

  let beforeState: Record<string, unknown> | null = null;
  if (isGlobalStylesWrite) {
    try {
      const pre = await target.rest({
        method: "GET",
        path: `${input.path}${input.path.includes("?") ? "&" : "?"}context=edit`,
      });
      if (pre.status >= 200 && pre.status < 300) {
        const b = (pre.body ?? {}) as Record<string, unknown>;
        beforeState = {
          id: b["id"] ?? null,
          styles: b["styles"] ?? null,
          settings: b["settings"] ?? null,
        };
      }
    } catch {
      /* swallow — write proceeds without revert capability */
    }
  }

  const req: Parameters<typeof target.rest>[0] = {
    method: input.method,
    path: input.path,
  };
  if (input.query !== undefined) req.query = input.query;
  if (input.body !== undefined) req.body = input.body;
  if (input.headers !== undefined) req.headers = input.headers;
  const res = await target.rest(req);

  if (isGlobalStylesWrite && res.status >= 200 && res.status < 300) {
    const record: Parameters<typeof recordChange>[1] = {
      category: "layout",
      subcategory: "global_styles",
      targetDescriptor: `${input.method} ${input.path}`,
      beforeState: beforeState ?? null,
      afterState: input.body ?? null,
      reversible: beforeState !== null,
      sourceTool: "wp_rest_request",
    };
    if (beforeState === null) {
      record.notes = "no before-state captured — revert may be partial";
    }
    await recordChange(target, record);
    await flushObjectCache(target);
  }

  return RestRequestOutputSchema.parse({
    status: res.status,
    body: res.body,
    headers: res.headers,
  });
}
