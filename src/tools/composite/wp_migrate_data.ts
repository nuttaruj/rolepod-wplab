import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  MigrateDataInputSchema,
  MigrateDataOutputSchema,
  type MigrateDataInput,
  type MigrateDataOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpMigrateDataToolDef = {
  name: "rolepod_wp_migrate_data",
  description:
    "Apply a scoped migration between two targets. Scopes: plugin_versions (install/upgrade plugins on dest to match source) · options (copy named wp_options keys source→dest, serialized-safe via JSON round-trip; requires an `options` list; URL/identity keys siteurl/home/blogname are refused — use rolepod_wp_migrate_site) · users/posts (UNSUPPORTED — selective migration is lossy; use rolepod_wp_clone shell↔shell or rolepod_wp_migrate_site rest↔rest for a full copy). Requires allow_destructive=true. Production guard on dest fires unless confirm=true.",
  inputSchema: MigrateDataInputSchema,
};

// wp_options keys that carry the site's identity / URLs. Copying these onto the
// dest breaks it (wrong home/siteurl) or lives inside serialized data that a
// plain option write corrupts. Full-site tools handle the URL rewrite safely.
const URL_BEARING_OPTIONS = new Set(["siteurl", "home", "blogname"]);

export async function wpMigrateDataHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<MigrateDataOutput> {
  const input: MigrateDataInput = MigrateDataInputSchema.parse(raw);
  const source = registry.get(input.source_target_id);
  const dest = registry.get(input.dest_target_id);

  const matched = prodGuard.matches(dest.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "migrate_data dest is production-matched; pass confirm=true to proceed",
      { dest_siteurl: dest.siteurl, matchedPattern: matched.pattern },
    );
  }

  const runId = makeRunId();
  let applied: MigrateDataOutput["applied"] = [];

  if (input.scope === "plugin_versions") {
    applied = await migratePluginVersions(source, dest);
  } else if (input.scope === "options") {
    const names = input.options ?? [];
    if (names.length === 0) {
      throw new WplabError(
        "OPTIONS_LIST_REQUIRED",
        "scope=options requires a non-empty `options` list (wp_options keys to copy)",
        {},
      );
    }
    applied = await migrateOptions(source, dest, names);
  } else if (input.scope === "users" || input.scope === "posts") {
    throw new WplabError(
      "MIGRATE_SCOPE_UNSUPPORTED",
      `scope=${input.scope} is not supported — selective ${input.scope} migration is lossy (ids/relations/attachments${input.scope === "users" ? "/password hashes" : ""}). Use rolepod_wp_clone (shell↔shell) or rolepod_wp_migrate_site (rest↔rest) for a full-site copy.`,
      { scope: input.scope },
    );
  }

  const artifactDir = join(process.cwd(), ".rolepod-wplab", "artifacts", runId);
  await mkdir(artifactDir, { recursive: true });
  const reportPath = join(artifactDir, "migrate-data-report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        run_id: runId,
        scope: input.scope,
        source: source.siteurl,
        dest: dest.siteurl,
        applied,
      },
      null,
      2,
    ),
    "utf8",
  );

  return MigrateDataOutputSchema.parse({
    run_id: runId,
    scope: input.scope,
    applied,
    report_path: reportPath,
  });
}

async function migratePluginVersions(
  source: Target,
  dest: Target,
): Promise<MigrateDataOutput["applied"]> {
  const [srcList, dstList] = await Promise.all([
    pluginsOf(source),
    pluginsOf(dest),
  ]);
  const dstMap = new Map(dstList.map((p) => [p.name, p]));
  const applied: MigrateDataOutput["applied"] = [];

  for (const sp of srcList) {
    const dp = dstMap.get(sp.name);
    if (!dp) {
      // install missing plugin
      const r = await dest.wpCli(
        ["plugin", "install", sp.name, "--version=" + sp.version, "--activate"],
        {
          allowDestructive: true,
        },
      );
      applied.push({
        action: "install",
        slug: sp.name,
        to: sp.version,
        ok: r.exitCode === 0,
        ...(r.exitCode === 0 ? {} : { error: r.stderr.slice(0, 200) }),
      });
    } else if (dp.version !== sp.version) {
      // version mismatch — upgrade/downgrade dest to match source
      const action: "upgrade" | "downgrade" = isNewer(sp.version, dp.version)
        ? "upgrade"
        : "downgrade";
      const r = await dest.wpCli(
        ["plugin", "install", sp.name, "--version=" + sp.version, "--force"],
        {
          allowDestructive: true,
        },
      );
      applied.push({
        action,
        slug: sp.name,
        from: dp.version,
        to: sp.version,
        ok: r.exitCode === 0,
        ...(r.exitCode === 0 ? {} : { error: r.stderr.slice(0, 200) }),
      });
    } else {
      applied.push({
        action: "noop",
        slug: sp.name,
        from: dp.version,
        to: sp.version,
        ok: true,
      });
    }
  }

  return applied;
}

async function migrateOptions(
  source: Target,
  dest: Target,
  names: string[],
): Promise<MigrateDataOutput["applied"]> {
  // Refuse URL/identity options up front — one bad key aborts the whole run
  // rather than half-applying and pointing the dest at the source's domain.
  const refused = names.filter((n) => URL_BEARING_OPTIONS.has(n));
  if (refused.length) {
    throw new WplabError(
      "OPTION_MIGRATE_URL_REFUSED",
      `refusing to migrate URL/identity options (${refused.join(", ")}) — these define the dest's identity and live in serialized data. Use rolepod_wp_migrate_site (full host-to-host) or rolepod_wp_clone with URL rewrite instead.`,
      { refused },
    );
  }

  const applied: MigrateDataOutput["applied"] = [];
  for (const name of names) {
    // Read the source value as JSON so serialized arrays/objects round-trip
    // intact (a plaintext read + write mangles them).
    const got = await source.wpCli(["option", "get", name, "--format=json"]);
    if (got.exitCode !== 0) {
      applied.push({
        action: "option_set",
        option: name,
        ok: false,
        error: `source has no option '${name}' (or read failed)`,
      });
      continue;
    }
    const value = got.stdout.trim();
    const set = await dest.wpCli(
      ["option", "update", name, value, "--format=json"],
      { allowDestructive: true },
    );
    applied.push({
      action: "option_set",
      option: name,
      ok: set.exitCode === 0,
      ...(set.exitCode === 0 ? {} : { error: set.stderr.slice(0, 200) }),
    });
  }
  return applied;
}

async function pluginsOf(
  t: Target,
): Promise<Array<{ name: string; version: string }>> {
  const r = await t.wpCli(["plugin", "list", "--format=json"]);
  if (r.exitCode !== 0) return [];
  try {
    return JSON.parse(r.stdout || "[]") as Array<{
      name: string;
      version: string;
    }>;
  } catch {
    return [];
  }
}

function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return false;
}
