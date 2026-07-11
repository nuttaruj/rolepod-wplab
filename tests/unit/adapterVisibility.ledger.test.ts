import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

// Adapters detect + write — stub both so the handler reaches recordChange.
vi.mock("../../src/adapters/woocommerce/read.js", () => ({
  woocommerceAdapter: { detect: async () => true },
}));
vi.mock("../../src/adapters/woocommerce/write.js", () => ({
  woocommerceWrite: {
    updateProduct: async () => ({ id: 1 }),
    bulkUpdatePrices: async () => ({ updated: 2, failed: 0 }),
  },
}));
vi.mock("../../src/adapters/forms/read.js", () => ({
  formsAdapter: { read: { detectEngine: async () => "gravity" } },
}));
vi.mock("../../src/adapters/forms/write.js", () => ({
  formsWrite: {
    deleteEntry: async () => ({ source: "wp_cli" }),
    markSpam: async () => ({ source: "wp_cli" }),
    unmarkSpam: async () => ({ source: "wp_cli" }),
  },
}));
vi.mock("../../src/adapters/wpml/read.js", () => ({
  wpmlAdapter: { detect: async () => true },
}));
vi.mock("../../src/adapters/wpml/write.js", () => ({
  wpmlWrite: {
    setPostLanguage: async () => ({ source: "wp_cli" }),
    linkTranslations: async () => ({ source: "rest", linked_count: 2 }),
    duplicateForTranslation: async () => ({
      source: "wp_cli",
      new_post_id: 99,
    }),
  },
}));

const { wpWooWriteHandler } =
  await import("../../src/tools/adapter/wp_woo_write.js");
const { wpFormsWriteHandler } =
  await import("../../src/tools/adapter/wp_forms_write.js");
const { wpWpmlWriteHandler } =
  await import("../../src/tools/adapter/wp_wpml_write.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const registry = {
  get: () => ({ id: "tgt_vis00001", kind: "rest", siteurl: "https://x.test" }),
} as unknown as TargetRegistry;
const guard = new ProdGuard([]);

beforeEach(() => recordChange.mockClear());
const row = () => recordChange.mock.calls.at(-1)![1];

describe("woo/forms/wpml — visibility rows, never claimed reversible", () => {
  it("woo update_product records a non-reversible row", async () => {
    await wpWooWriteHandler(registry, guard, {
      target_id: "tgt_vis00001",
      op: "update_product",
      product_id: 5,
      fields: { regular_price: "9.99" },
      allow_destructive: true,
    });
    expect(row()).toMatchObject({
      category: "post",
      subcategory: "product:5",
      reversible: false,
    });
    expect(row().notes).toMatch(/cannot be reverted/i);
  });

  it("forms delete_entry records a non-reversible row that says it is permanent", async () => {
    await wpFormsWriteHandler(registry, guard, {
      target_id: "tgt_vis00001",
      engine: "gravity",
      op: "delete_entry",
      entry_id: 7,
      allow_destructive: true,
    });
    expect(row()).toMatchObject({ reversible: false });
    expect(row().notes).toMatch(/cannot be undone/i);
  });

  it("forms mark_spam note points at the inverse op", async () => {
    await wpFormsWriteHandler(registry, guard, {
      target_id: "tgt_vis00001",
      engine: "gravity",
      op: "mark_spam",
      entry_id: 7,
      allow_destructive: true,
    });
    expect(row().notes).toMatch(/unmark_spam/);
  });

  it("wpml duplicate records a non-reversible row naming the new post", async () => {
    await wpWpmlWriteHandler(registry, guard, {
      target_id: "tgt_vis00001",
      op: "duplicate_for_translation",
      post_id: 3,
      target_language: "th",
      allow_destructive: true,
    });
    expect(row()).toMatchObject({
      subcategory: "wpml:duplicate_for_translation",
      reversible: false,
      afterState: { source_post_id: 3, new_post_id: 99 },
    });
  });
});
