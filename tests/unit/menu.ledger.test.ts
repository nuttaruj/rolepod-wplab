import { beforeEach, describe, expect, it, vi } from "vitest";

const recordChange = vi.fn(async () => ({ auditId: "aud" }));
vi.mock("../../src/companion/ledger.js", () => ({ recordChange }));

const executePhp = vi.fn();
vi.mock("../../src/companion/Bridge.js", () => ({
  bridgeFor: async () => ({ executePhp }),
}));

const { wpMenuCreateHandler } =
  await import("../../src/tools/atomic/wp_menu_create.js");
const { wpMenuAddItemHandler } =
  await import("../../src/tools/atomic/wp_menu_add_item.js");
const { wpMenuAssignHandler } =
  await import("../../src/tools/atomic/wp_menu_assign.js");
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const target = {
  id: "tgt_menu0001",
  kind: "rest",
  siteurl: "https://x.test",
  companion: { enabled: true },
} as const;
const registry = { get: () => target } as unknown as TargetRegistry;

beforeEach(() => {
  recordChange.mockClear();
  executePhp.mockReset();
});

const lastRow = () => recordChange.mock.calls.at(-1)![1];

describe("nav-menu ledger rows are honest about reversibility", () => {
  it("menu_create records a NON-reversible row — a menu is a term, not post meta", async () => {
    executePhp.mockResolvedValue({
      ok: true,
      return_value: { menu_id: 5, created: true, name: "Main" },
    });
    await wpMenuCreateHandler(registry, {
      target_id: "tgt_menu0001",
      name: "Main",
    });
    expect(lastRow()).toMatchObject({ reversible: false });
    expect(lastRow().notes).toMatch(/wp menu delete 5|Appearance/);
  });

  it("menu_add_item records a NON-reversible row — an item is a post", async () => {
    executePhp.mockResolvedValue({
      ok: true,
      return_value: { item_id: 42, menu_id: 5 },
    });
    await wpMenuAddItemHandler(registry, {
      target_id: "tgt_menu0001",
      menu_id: 5,
      title: "Home",
      type: "custom",
      url: "https://x.test/",
    });
    expect(lastRow()).toMatchObject({ reversible: false });
    expect(lastRow().notes).toMatch(/42/);
  });

  it("menu_assign is non-reversible but preserves the previous menu id in its note", async () => {
    executePhp.mockResolvedValue({
      ok: true,
      return_value: { location: "primary", menu_id: 5, previous_menu_id: 3 },
    });
    await wpMenuAssignHandler(registry, {
      target_id: "tgt_menu0001",
      menu_id: 5,
      location: "primary",
    });
    expect(lastRow()).toMatchObject({
      reversible: false,
      beforeState: { menu_id: 3 },
    });
    expect(lastRow().notes).toMatch(/back to menu 3/);
  });

  it("menu_assign note handles no previous menu", async () => {
    executePhp.mockResolvedValue({
      ok: true,
      return_value: { location: "primary", menu_id: 5, previous_menu_id: null },
    });
    await wpMenuAssignHandler(registry, {
      target_id: "tgt_menu0001",
      menu_id: 5,
      location: "primary",
    });
    expect(lastRow().notes).toMatch(/had no menu before/);
  });
});
