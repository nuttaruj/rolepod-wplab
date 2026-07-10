import { describe, expect, it } from "vitest";
import {
  classifyBuilders,
  type PluginRow,
  type ThemeRow,
} from "../../src/lib/classifyBuilders.js";

const plugin = (
  name: string,
  status = "active",
  version = "1.0",
): PluginRow => ({
  name,
  status,
  version,
});
const theme = (name: string, status = "active"): ThemeRow => ({ name, status });

const run = (plugins: PluginRow[], themes: ThemeRow[] = []) =>
  classifyBuilders({ plugins, themes, wpVersion: "6.5" });

describe("classifyBuilders", () => {
  it("detects Bricks from the active THEME, not the plugin list", () => {
    // This is the bug fix: Bricks ships as a theme and was never found before.
    const out = run([], [theme("bricks")]);
    expect(out.primary).toBe("bricks");
    expect(out.active_builders[0]).toMatchObject({
      slug: "bricks",
      supported: true,
      write_support: true,
    });
  });

  it("does not detect Bricks when its theme is installed but inactive", () => {
    const out = run([], [theme("bricks", "inactive"), theme("astra")]);
    expect(out.primary).toBe("gutenberg");
  });

  it("detects Elementor free vs Pro", () => {
    expect(run([plugin("elementor")]).active_builders[0]).toMatchObject({
      slug: "elementor",
      pro: false,
    });
    const pro = run([plugin("elementor"), plugin("elementor-pro")]);
    expect(pro.active_builders[0]).toMatchObject({
      slug: "elementor",
      pro: true,
    });
    expect(pro.active_builders[0]!.capabilities).toContain("theme-builder");
  });

  it("detects Divi from either the plugin or the theme", () => {
    expect(run([plugin("divi-builder")]).primary).toBe("divi");
    expect(run([], [theme("Divi")]).primary).toBe("divi");
  });

  it("detects Oxygen from the plugin", () => {
    expect(run([plugin("oxygen")]).primary).toBe("oxygen");
  });

  it.each([
    ["beaver-builder-lite-version", "beaver-builder"],
    ["bb-plugin", "beaver-builder"],
    ["js_composer", "visual-composer"],
    ["breakdance", "breakdance"],
    ["brizy", "brizy"],
  ])("reports %s as detected but unsupported", (pluginName, slug) => {
    const out = run([plugin(pluginName)]);
    const found = out.active_builders.find((b) => b.slug === slug);
    expect(found).toMatchObject({ supported: false, write_support: false });
  });

  it("falls back to Gutenberg only when no builder is present", () => {
    const out = run([plugin("akismet"), plugin("woocommerce")]);
    expect(out.active_builders).toHaveLength(1);
    expect(out.active_builders[0]).toMatchObject({
      slug: "gutenberg",
      supported: true,
    });
  });

  it("does not fall back to Gutenberg when an unsupported builder is active", () => {
    const out = run([plugin("breakdance")]);
    expect(out.active_builders.map((b) => b.slug)).not.toContain("gutenberg");
    expect(out.primary).toBe("breakdance");
  });

  it("ranks a supported builder ahead of an unsupported one for primary", () => {
    const out = run([plugin("breakdance"), plugin("elementor")]);
    expect(out.primary).toBe("elementor");
    expect(out.active_builders.map((b) => b.slug).sort()).toEqual([
      "breakdance",
      "elementor",
    ]);
  });

  it("ignores inactive plugins", () => {
    expect(run([plugin("elementor", "inactive")]).primary).toBe("gutenberg");
  });
});
