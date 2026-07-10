import type { WpBuilderDetectOutput } from "../schema/tools.js";

export type DetectedBuilder = WpBuilderDetectOutput["active_builders"][number];

export interface PluginRow {
  name: string;
  status: string;
  version: string;
}

export interface ThemeRow {
  name: string;
  status: string;
}

export interface BuilderSignals {
  plugins: PluginRow[];
  /** `wp theme list --format=json` — Bricks and Divi ship as themes. */
  themes: ThemeRow[];
  wpVersion: string;
}

const activePlugin = (plugins: PluginRow[], re: RegExp): PluginRow | null =>
  plugins.find((p) => p.status === "active" && re.test(p.name)) ?? null;

const activeThemeMatches = (themes: ThemeRow[], re: RegExp): boolean =>
  themes.some((t) => t.status === "active" && re.test(t.name));

/**
 * Classify the page builders in use from plugin + theme + core-version signals.
 *
 * Pure so it can be unit-tested without a live target. The handler's only job
 * is to gather the three signals and hand them here.
 *
 * Two things the previous version got wrong:
 *   - Bricks was looked up in the PLUGIN list. Bricks is a theme; it was never
 *     detected on a real Bricks site.
 *   - Builders with no adapter were invisible. Now they are reported with
 *     `supported: false` so the caller can say "Beaver Builder is active but I
 *     cannot edit it" instead of silently falling through to Gutenberg.
 */
export function classifyBuilders(signals: BuilderSignals): {
  active_builders: DetectedBuilder[];
  primary: DetectedBuilder["slug"] | null;
} {
  const { plugins, themes, wpVersion } = signals;
  const active: DetectedBuilder[] = [];

  const elementor = activePlugin(plugins, /^elementor$/);
  if (elementor) {
    const pro = !!activePlugin(plugins, /^elementor-pro$/);
    active.push({
      slug: "elementor",
      version: elementor.version,
      capabilities: pro
        ? ["widgets", "templates", "theme-builder", "popups", "forms"]
        : ["widgets", "templates"],
      pro,
      supported: true,
      write_support: true,
    });
  }

  // Bricks is a THEME, not a plugin.
  if (activeThemeMatches(themes, /^bricks$/i)) {
    const themeRow = themes.find((t) => /^bricks$/i.test(t.name));
    active.push({
      slug: "bricks",
      version: (themeRow as { version?: string })?.version ?? "theme",
      capabilities: ["elements", "templates", "theme"],
      pro: true,
      supported: true,
      write_support: true,
    });
  }

  const diviPlugin = activePlugin(plugins, /^divi-builder$/);
  const diviTheme = activeThemeMatches(themes, /^divi$/i);
  if (diviPlugin || diviTheme) {
    active.push({
      slug: "divi",
      version: diviPlugin?.version ?? "theme",
      capabilities: ["modules", "theme-builder", "library"],
      pro: true,
      supported: true,
      write_support: true,
    });
  }

  const oxygen = activePlugin(plugins, /^oxygen$/);
  if (oxygen) {
    active.push({
      slug: "oxygen",
      version: oxygen.version,
      capabilities: ["elements", "templates"],
      pro: true,
      supported: true,
      write_support: true,
    });
  }

  // Detected-but-unsupported: report them so the caller does not promise an
  // edit the adapter cannot make.
  const beaver = activePlugin(plugins, /beaver-builder|^bb-plugin$/);
  if (beaver) {
    active.push({
      slug: "beaver-builder",
      version: beaver.version,
      capabilities: ["modules"],
      pro: /agency|pro/i.test(beaver.name),
      supported: false,
      write_support: false,
    });
  }

  const wpbakery = activePlugin(plugins, /^js_composer$/);
  if (wpbakery) {
    active.push({
      slug: "visual-composer",
      version: wpbakery.version,
      capabilities: ["elements"],
      pro: true,
      supported: false,
      write_support: false,
    });
  }

  const breakdance = activePlugin(plugins, /^breakdance$/);
  if (breakdance) {
    active.push({
      slug: "breakdance",
      version: breakdance.version,
      capabilities: ["elements", "templates"],
      pro: true,
      supported: false,
      write_support: false,
    });
  }

  const brizy = activePlugin(plugins, /^brizy$/);
  if (brizy) {
    active.push({
      slug: "brizy",
      version: brizy.version,
      capabilities: ["blocks"],
      pro: false,
      supported: false,
      write_support: false,
    });
  }

  // Gutenberg is core. Only report it when no dedicated builder is present —
  // a Bricks site also technically has the block editor, but that is not the
  // builder the user means.
  if (active.length === 0) {
    active.push({
      slug: "gutenberg",
      version: wpVersion,
      capabilities: ["blocks", "patterns", "fse"],
      pro: false,
      supported: true,
      write_support: true,
    });
  }

  // A supported builder outranks an unsupported one for `primary`, so the
  // suggested next step is one the server can actually carry out.
  const ranked = [...active].sort(
    (a, b) => Number(b.supported) - Number(a.supported),
  );
  return { active_builders: active, primary: ranked[0]?.slug ?? null };
}
