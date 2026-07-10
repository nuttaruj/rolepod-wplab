import {
  WpBuilderDetectInputSchema,
  WpBuilderDetectOutputSchema,
  type WpBuilderDetectInput,
  type WpBuilderDetectOutput,
} from "../../schema/tools.js";
import {
  classifyBuilders,
  type PluginRow,
  type ThemeRow,
} from "../../lib/classifyBuilders.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpBuilderDetectToolDef = {
  name: "rolepod_wp_builder_detect",
  description:
    "Detect which page builder(s) are active on the target. Inspects active plugins AND active themes (Bricks and Divi ship as themes, not plugins) plus the WP version for block-theme detection. Each result carries `supported` / `write_support` so a detected-but-uneditable builder (Beaver, WPBakery, Breakdance, Brizy) is reported rather than mistaken for Gutenberg. Use BEFORE choosing which catalog (elementor.md / bricks.md / divi.md / gutenberg.md) to load.",
  inputSchema: WpBuilderDetectInputSchema,
};

export async function wpBuilderDetectHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpBuilderDetectOutput> {
  const input: WpBuilderDetectInput = WpBuilderDetectInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const [plugins, themes, wpVersion] = await Promise.all([
    fetchPlugins(target),
    fetchThemes(target),
    getWpVersion(target),
  ]);

  return WpBuilderDetectOutputSchema.parse(
    classifyBuilders({ plugins, themes, wpVersion }),
  );
}

async function fetchPlugins(target: Target): Promise<PluginRow[]> {
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

async function fetchThemes(target: Target): Promise<ThemeRow[]> {
  try {
    const r = await target.wpCli(["theme", "list", "--format=json"], {
      allowDestructive: false,
      timeoutMs: 10_000,
    });
    if (r.exitCode !== 0) return [];
    const parsed = JSON.parse(r.stdout.trim()) as ThemeRow[];
    return parsed.filter((t) => typeof t.name === "string");
  } catch {
    return [];
  }
}

async function getWpVersion(target: Target): Promise<string> {
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
