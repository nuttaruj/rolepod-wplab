import { describe, expect, it, vi } from "vitest";
import { wpElementorReadHandler } from "../../src/tools/adapter/wp_elementor_read.js";
import { elementorAdapter } from "../../src/adapters/elementor/read.js";
import type { Target } from "../../src/runtime/Target.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

// Live-verified shape from https://srv1475649.hstgr.cloud (Elementor):
// GET /elementor/v1/globals → { colors: {...}, typography: {...} }
const GLOBALS = {
  colors: {
    primary: { id: "primary", title: "Primary", value: "#6EC1E4" },
    accent: { id: "accent", title: "Accent", value: "#61CE70" },
  },
  typography: {
    primary: {
      id: "primary",
      title: "Primary",
      value: {
        typography_font_family: "Roboto",
        typography_font_weight: "600",
      },
    },
  },
};

function restTarget(rest: ReturnType<typeof vi.fn>): Target {
  return {
    id: "tgt_ekit0001",
    kind: "rest",
    siteurl: "https://x.test",
    companion: { enabled: true },
    rest,
  } as unknown as Target;
}

describe("elementor kit read (WS12-T4, read-only)", () => {
  it("getKit reads global colors + typography from /elementor/v1/globals", async () => {
    const rest = vi.fn(async (req: { method: string; path: string }) => {
      expect(req.method).toBe("GET");
      expect(req.path).toBe("/elementor/v1/globals");
      return { status: 200, body: GLOBALS, headers: {} };
    });
    const kit = await elementorAdapter.read.getKit(restTarget(rest));
    expect(kit.colors).toEqual(GLOBALS.colors);
    expect(kit.typography).toEqual(GLOBALS.typography);
    expect(rest).toHaveBeenCalledOnce();
  });

  it("getKit throws on a non-2xx (never fakes a success)", async () => {
    const rest = vi.fn(async () => ({ status: 401, body: {}, headers: {} }));
    await expect(
      elementorAdapter.read.getKit(restTarget(rest)),
    ).rejects.toThrow(/HTTP 401/);
  });

  it("handler kit=true returns mode:kit with the globals; detect() gates it", async () => {
    // rest() serves both the detect probe (`/` → routes) and the globals read.
    const rest = vi.fn(async (req: { method: string; path: string }) => {
      if (req.path === "/")
        return {
          status: 200,
          body: { routes: { "/elementor/v1": {} } },
          headers: {},
        };
      return { status: 200, body: GLOBALS, headers: {} };
    });
    const registry = {
      get: () => restTarget(rest),
    } as unknown as TargetRegistry;
    const out = await wpElementorReadHandler(registry, {
      target_id: "tgt_ekit0001",
      kit: true,
    });
    expect(out).toMatchObject({ mode: "kit", detected: true });
    expect((out.kit as { colors?: unknown }).colors).toEqual(GLOBALS.colors);
  });

  it("kit=true takes precedence over page_id", async () => {
    const rest = vi.fn(async (req: { path: string }) => {
      if (req.path === "/")
        return {
          status: 200,
          body: { routes: { "/elementor/v1": {} } },
          headers: {},
        };
      return { status: 200, body: GLOBALS, headers: {} };
    });
    const registry = {
      get: () => restTarget(rest),
    } as unknown as TargetRegistry;
    const out = await wpElementorReadHandler(registry, {
      target_id: "tgt_ekit0001",
      kit: true,
      page_id: 46,
    });
    expect(out.mode).toBe("kit");
    // never fetched a page — only detect(/) + globals
    expect(
      rest.mock.calls.every(
        (c) => c[0].path === "/" || c[0].path === "/elementor/v1/globals",
      ),
    ).toBe(true);
  });
});
