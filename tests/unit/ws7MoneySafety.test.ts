import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));
vi.mock("../../src/companion/cacheFlush.js", () => ({
  flushObjectCache: vi.fn(async () => {}),
}));
vi.mock("../../src/adapters/woocommerce/read.js", () => ({
  woocommerceAdapter: { detect: vi.fn(async () => true) },
}));

const { isMoneyEndpointWrite, wpRestRequestHandler } =
  await import("../../src/tools/atomic/wp_rest_request.js");
const { wpProductCreateHandler } =
  await import("../../src/tools/atomic/wp_product_create.js");
const { wpWooWriteHandler } =
  await import("../../src/tools/adapter/wp_woo_write.js");
const { wpDbQueryHandler } =
  await import("../../src/tools/atomic/wp_db_query.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function restReg(rest: ReturnType<typeof vi.fn>, siteurl = "https://x.test") {
  const target = {
    id: "tgt_woo00001",
    kind: "rest",
    siteurl,
    companion: { enabled: true },
    rest,
  };
  return { get: () => target } as unknown as TargetRegistry;
}
const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

describe("WS7-T4 — money-endpoint seal", () => {
  it("classifies money writes (incl. no-leading-slash + v1) as blocked", () => {
    expect(isMoneyEndpointWrite("POST", "wc/v3/orders/5/refunds")).toBe(true);
    expect(isMoneyEndpointWrite("POST", "/wc/v1/coupons")).toBe(true);
    expect(isMoneyEndpointWrite("DELETE", "/WC/V2/orders/9")).toBe(true);
    // reads and non-money writes pass
    expect(isMoneyEndpointWrite("GET", "/wc/v3/orders")).toBe(false);
    expect(isMoneyEndpointWrite("POST", "/wc/v3/products")).toBe(false);
    expect(isMoneyEndpointWrite("POST", "/wp/v2/posts")).toBe(false);
  });

  it("refuses a raw refund POST in the handler", async () => {
    const rest = vi.fn(async () => ({ status: 200, body: {}, headers: {} }));
    await expect(
      wpRestRequestHandler(restReg(rest), {
        target_id: "tgt_woo00001",
        method: "POST",
        path: "/wc/v3/orders/5/refunds",
      }),
    ).rejects.toMatchObject({ code: "WC_MONEY_ENDPOINT_BLOCKED" });
    expect(rest).not.toHaveBeenCalled();
  });

  it("lets a normal /wp/v2 write through", async () => {
    const rest = vi.fn(async () => ({
      status: 200,
      body: { id: 1 },
      headers: {},
    }));
    await wpRestRequestHandler(restReg(rest), {
      target_id: "tgt_woo00001",
      method: "POST",
      path: "/wp/v2/posts",
      body: { title: "x" },
    });
    expect(rest).toHaveBeenCalled();
  });
});

describe("WS7-T4 — seal hardening (adversarial-review regressions)", () => {
  it("catches percent-encoded money keywords (decode before match)", () => {
    expect(isMoneyEndpointWrite("POST", "wc/v3/%6frders/123/%72efunds")).toBe(
      true,
    );
    expect(isMoneyEndpointWrite("POST", "wc/v3/%6frders")).toBe(true);
    // double-encoded
    expect(isMoneyEndpointWrite("POST", "wc/v3/%256frders")).toBe(true);
  });

  it("catches a money route hidden in the rest_route query var", () => {
    expect(
      isMoneyEndpointWrite("POST", "/wp/v2/types", {
        rest_route: "/wc/v3/orders/123/refunds",
      }),
    ).toBe(true);
    expect(
      isMoneyEndpointWrite("POST", "/wp/v2/types", {
        rest_route: "/wc/v3/%6frders/1/%72efunds",
      }),
    ).toBe(true);
  });

  it("catches the Store API checkout (payment) namespace", () => {
    expect(isMoneyEndpointWrite("POST", "/wc/store/v1/checkout")).toBe(true);
    expect(isMoneyEndpointWrite("POST", "wc/store/checkout")).toBe(true);
  });

  it("handler refuses the rest_route-query bypass without hitting the wire", async () => {
    const rest = vi.fn(async () => ({ status: 200, body: {}, headers: {} }));
    await expect(
      wpRestRequestHandler(restReg(rest), {
        target_id: "tgt_woo00001",
        method: "POST",
        path: "/wp/v2/types",
        query: { rest_route: "/wc/v3/orders/9/refunds" },
        body: { amount: "999" },
      }),
    ).rejects.toMatchObject({ code: "WC_MONEY_ENDPOINT_BLOCKED" });
    expect(rest).not.toHaveBeenCalled();
  });
});

describe("WS7 — woo_write honesty (adversarial-review regressions)", () => {
  it("bulk_update_prices counts WC per-item errors as failed (200 partial)", async () => {
    // WC batch returns 200 with a failed item embedded as { id, error }.
    const rest = vi.fn(async () => ({
      status: 200,
      body: {
        update: [
          { id: 10, price: "9.99" },
          {
            id: 999999,
            error: { code: "woocommerce_rest_product_invalid_id" },
          },
        ],
      },
      headers: {},
    }));
    const out = await wpWooWriteHandler(restReg(rest), guard, {
      target_id: "tgt_woo00001",
      op: "bulk_update_prices",
      price_updates: [
        { id: 10, regular_price: "9.99" },
        { id: 999999, regular_price: "9.99" },
      ],
      allow_destructive: true,
    });
    expect(out.result).toMatchObject({ updated: 1, failed: 1 });
  });

  it("update_product surfaces the WC error code (not a bare HTTP status)", async () => {
    const rest = vi.fn(async () => ({
      status: 400,
      body: {
        code: "product_invalid_sku",
        message: "Invalid or duplicate SKU.",
      },
      headers: {},
    }));
    await expect(
      wpWooWriteHandler(restReg(rest), guard, {
        target_id: "tgt_woo00001",
        op: "update_product",
        product_id: 5,
        fields: { sku: "TAKEN" },
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "product_invalid_sku" });
  });
});

describe("WS7-T1 — product_create via WC REST CRUD", () => {
  it("POSTs to /wc/v3/products with manage_stock + stock_quantity:0", async () => {
    const rest = vi.fn(async () => ({
      status: 201,
      body: { id: 88, permalink: "https://x.test/?p=88" },
      headers: {},
    }));
    const out = (await wpProductCreateHandler(restReg(rest), guard, {
      target_id: "tgt_woo00001",
      name: "Widget",
      regular_price: "9.99",
      stock: 0,
    })) as { product_id: number };
    expect(out.product_id).toBe(88);
    const call = rest.mock.calls[0]?.[0];
    expect(call.path).toBe("/wc/v3/products");
    expect(call.body).toMatchObject({
      type: "simple",
      manage_stock: true,
      stock_quantity: 0,
    });
  });

  it("surfaces a duplicate SKU as product_invalid_sku", async () => {
    const rest = vi.fn(async () => ({
      status: 400,
      body: {
        code: "product_invalid_sku",
        message: "Invalid or duplicated SKU.",
      },
      headers: {},
    }));
    await expect(
      wpProductCreateHandler(restReg(rest), guard, {
        target_id: "tgt_woo00001",
        name: "Dup",
        regular_price: "1.00",
        sku: "TAKEN",
      }),
    ).rejects.toMatchObject({ code: "product_invalid_sku" });
  });

  it("blocks a prod create without confirm", async () => {
    const rest = vi.fn();
    await expect(
      wpProductCreateHandler(
        restReg(rest, "https://prod.test"),
        new ProdGuard(["prod.test"]),
        { target_id: "tgt_woo00001", name: "P", regular_price: "1.00" },
      ),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });
    expect(rest).not.toHaveBeenCalled();
  });
});

describe("WS7-T3 — refund money gate", () => {
  it("api_refund omitted → record-only refund, api_refund:false on the wire", async () => {
    const rest = vi.fn(async () => ({
      status: 201,
      body: { id: 1 },
      headers: {},
    }));
    const out = await wpWooWriteHandler(restReg(rest), guard, {
      target_id: "tgt_woo00001",
      op: "create_refund",
      order_id: 7,
      refund_amount: "5.00",
      allow_destructive: true,
    });
    expect(out.op).toBe("create_refund");
    const call = rest.mock.calls[0]?.[0];
    expect(call.path).toBe("/wc/v3/orders/7/refunds");
    expect(call.body).toMatchObject({ api_refund: false, amount: "5.00" });
  });

  it("api_refund=true without confirm → MONEY_OP_NEEDS_CONFIRM (no wire call)", async () => {
    const rest = vi.fn(async () => ({
      status: 201,
      body: { id: 1 },
      headers: {},
    }));
    await expect(
      wpWooWriteHandler(restReg(rest), guard, {
        target_id: "tgt_woo00001",
        op: "create_refund",
        order_id: 7,
        refund_amount: "5.00",
        api_refund: true,
        allow_destructive: true,
      }),
    ).rejects.toMatchObject({ code: "MONEY_OP_NEEDS_CONFIRM" });
    expect(rest).not.toHaveBeenCalled();
  });

  it("api_refund=true + confirm → gateway refund proceeds", async () => {
    const rest = vi.fn(async () => ({
      status: 201,
      body: { id: 2 },
      headers: {},
    }));
    const out = await wpWooWriteHandler(restReg(rest), guard, {
      target_id: "tgt_woo00001",
      op: "create_refund",
      order_id: 7,
      refund_amount: "5.00",
      api_refund: true,
      confirm: true,
      allow_destructive: true,
    });
    expect(out.op).toBe("create_refund");
    expect(rest.mock.calls[0]?.[0].body).toMatchObject({ api_refund: true });
  });
});

describe("WS7-T5 — HPOS static warning", () => {
  it("warns when a query touches order data", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    }));
    const registry = {
      get: () => ({
        id: "tgt_woo00001",
        kind: "local",
        siteurl: "https://x.test",
        wpCli,
      }),
    } as unknown as TargetRegistry;
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_woo00001",
      sql: "SELECT * FROM wp_posts WHERE post_type='shop_order'",
    });
    expect(out.warnings?.[0]).toMatch(/HPOS/);
  });

  it("no warning for a non-order query", async () => {
    const wpCli = vi.fn(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    }));
    const registry = {
      get: () => ({
        id: "tgt_woo00001",
        kind: "local",
        siteurl: "https://x.test",
        wpCli,
      }),
    } as unknown as TargetRegistry;
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_woo00001",
      sql: "SELECT ID FROM wp_posts LIMIT 1",
    });
    expect(out.warnings).toBeUndefined();
  });
});
