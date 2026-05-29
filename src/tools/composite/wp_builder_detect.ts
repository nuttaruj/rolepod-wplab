import {
  WpBuilderDetectInputSchema,
  WpBuilderDetectOutputSchema,
  type WpBuilderDetectInput,
  type WpBuilderDetectOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpBuilderDetectToolDef = {
  name: "rolepod_wp_builder_detect",
  description:
    "Detect which page builder(s) are active on the target. Inspects the active plugin list + WP version (for FSE/block-theme detection) + queries the per-builder presence signal. Returns ranked list with the most likely primary builder. Use BEFORE choosing which catalog (elementor.md / bricks.md / divi.md / gutenberg.md) to load.",
  inputSchema: WpBuilderDetectInputSchema,
};

interface PluginRow {
  name: string;
  status: string;
  version: string;
}

export async function wpBuilderDetectHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpBuilderDetectOutput> {
  const input: WpBuilderDetectInput = WpBuilderDetectInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const plugins = await fetchPlugins(target);

  const active: WpBuilderDetectOutput["active_builders"] = [];

  const elementor = findPlugin(plugins, "elementor");
  if (elementor && elementor.status === "active") {
    const pro =
      !!findPlugin(plugins, "elementor-pro") &&
      findPlugin(plugins, "elementor-pro")!.status === "active";
    active.push({
      slug: "elementor",
      version: elementor.version,
      capabilities: pro
        ? ["widgets", "templates", "theme-builder", "popups", "forms"]
        : ["widgets", "templates"],
      pro,
    });
  }

  const bricks =
    findPlugin(plugins, "bricks") || findPlugin(plugins, "bricks-builder");
  if (bricks && bricks.status === "active") {
    active.push({
      slug: "bricks",
      version: bricks.version,
      capabilities: ["elements", "templates", "theme"],
      pro: true,
    });
  }

  const divi = findPlugin(plugins, "divi-builder");
  // Divi is also a theme — check for active theme.
  const themeIsDivi = await isDiviTheme(target);
  if ((divi && divi.status === "active") || themeIsDivi) {
    active.push({
      slug: "divi",
      version: divi?.version ?? "theme",
      capabilities: ["modules", "theme-builder", "library"],
      pro: true,
    });
  }

  const oxygen = findPlugin(plugins, "oxygen");
  if (oxygen && oxygen.status === "active") {
    active.push({
      slug: "oxygen",
      version: oxygen.version,
      capabilities: ["elements", "templates"],
      pro: true,
    });
  }

  // Gutenberg is core — always "active" but only counts when no other builder is.
  if (active.length === 0) {
    const wpVersion = await getWpVersion(target);
    active.push({
      slug: "gutenberg",
      version: wpVersion,
      capabilities: ["blocks", "patterns", "fse"],
      pro: false,
    });
  }

  const primary = active.length > 0 ? active[0]!.slug : null;

  return WpBuilderDetectOutputSchema.parse({
    active_builders: active,
    primary,
  });
}

async function fetchPlugins(
  target: import("../../runtime/Target.js").Target,
): Promise<PluginRow[]> {
  try {
    const r = await target.wpCli(["plugin", "list", "--format=json"], {
      allowDestructive: false,
      timeoutMs: 15_000,
    });
    if (r.exitCode !== 0) return [];
    const parsed = JSON.parse(r.stdout.trim()) as PluginRow[];
    return parsed.filter((p) => typeof p.name === "string");
  } catch {
    return [];
  }
}

function findPlugin(plugins: PluginRow[], name: string): PluginRow | null {
  return plugins.find((p) => p.name === name) ?? null;
}

async function isDiviTheme(
  target: import("../../runtime/Target.js").Target,
): Promise<boolean> {
  try {
    const r = await target.wpCli(
      ["theme", "list", "--status=active", "--format=json"],
      {
        allowDestructive: false,
        timeoutMs: 10_000,
      },
    );
    if (r.exitCode !== 0) return false;
    const themes = JSON.parse(r.stdout.trim()) as Array<{ name: string }>;
    return themes.some((t) => /^Divi/i.test(t.name) || /divi/i.test(t.name));
  } catch {
    return false;
  }
}

async function getWpVersion(
  target: import("../../runtime/Target.js").Target,
): Promise<string> {
  try {
    const r = await target.wpCli(["core", "version"], {
      allowDestructive: false,
      timeoutMs: 10_000,
    });
    return r.exitCode === 0 ? r.stdout.trim() : "unknown";
  } catch {
    return "unknown";
  }
}
