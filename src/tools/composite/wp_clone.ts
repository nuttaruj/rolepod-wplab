import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRunId } from "../../artifact/runId.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  CloneInputSchema,
  CloneOutputSchema,
  type CloneInput,
  type CloneOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCloneToolDef = {
  name: "rolepod_wp_clone",
  description:
    "Clone a full WP site from source to dest. Steps: (1) db export source → import dest, (2) wp-content sync, (3) URL search-replace, (4) plugin version sync. Both targets must be shell-capable. Requires allow_destructive=true; production guard fires on dest unless confirm=true.",
  inputSchema: CloneInputSchema,
};

function ensureShell(t: Target, label: string): void {
  if (t.kind !== "local" && t.kind !== "ssh" && t.kind !== "docker") {
    throw new WplabError(
      "CLONE_REQUIRES_SHELL",
      `${label} target kind=${t.kind} not shell-capable`,
      { kind: t.kind },
    );
  }
}

export async function wpCloneHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<CloneOutput> {
  const input: CloneInput = CloneInputSchema.parse(raw);
  const source = registry.get(input.source_target_id);
  const dest = registry.get(input.dest_target_id);
  ensureShell(source, "source");
  ensureShell(dest, "dest");

  const matched = prodGuard.matches(dest.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "wp_clone dest is production — confirm=true required",
      {
        dest_siteurl: dest.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }

  const runId = makeRunId();
  const artifactDir = join(process.cwd(), ".rolepod-wplab", "artifacts", runId);
  await mkdir(artifactDir, { recursive: true });

  const steps: CloneOutput["steps"] = [];

  if (input.scope.includes("db")) {
    steps.push(await cloneDb(source, dest));
  }
  if (input.scope.includes("wp_content")) {
    steps.push(await cloneWpContent(source, dest));
  }
  if (input.rewrite_urls) {
    steps.push(await rewriteUrls(dest, source.siteurl, dest.siteurl));
  }
  if (input.scope.includes("plugin_versions")) {
    steps.push(await syncPluginVersions(source, dest));
  }

  const reportPath = join(artifactDir, "clone-report.json");
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        run_id: runId,
        source: source.siteurl,
        dest: dest.siteurl,
        scope: input.scope,
        steps,
      },
      null,
      2,
    ),
    "utf8",
  );

  return CloneOutputSchema.parse({
    run_id: runId,
    steps,
    report_path: reportPath,
  });
}

async function cloneDb(
  source: Target,
  dest: Target,
): Promise<CloneOutput["steps"][number]> {
  const dumpRel = `wp-content/uploads/wplab-clone/db-${Date.now()}.sql`;
  const dump = await source.wpCli(
    ["db", "export", dumpRel, "--add-drop-table"],
    { allowDestructive: true, timeoutMs: 120_000 },
  );
  if (dump.exitCode !== 0) {
    return { step: "db_export", ok: false, detail: dump.stderr.slice(0, 200) };
  }
  const srcReadAbs = await source.fileRead(dumpRel);
  const destWrite = await dest.fileWrite(dumpRel, srcReadAbs.content, {
    backup: false,
  });
  const imp = await dest.wpCli(["db", "import", destWrite.absolutePath], {
    allowDestructive: true,
    timeoutMs: 120_000,
  });
  if (imp.exitCode !== 0) {
    return { step: "db_import", ok: false, detail: imp.stderr.slice(0, 200) };
  }
  return { step: "db", ok: true, detail: `exported ${srcReadAbs.bytes} bytes` };
}

async function cloneWpContent(
  source: Target,
  dest: Target,
): Promise<CloneOutput["steps"][number]> {
  const subdirs = ["plugins", "themes", "uploads"];
  let copied = 0;
  for (const sub of subdirs) {
    const listing = await source.wpCli([
      "eval",
      `$d='wp-content/${sub}';foreach(glob(ABSPATH.$d.'/*') as $p){echo basename($p),"\\n";}`,
    ]);
    if (listing.exitCode !== 0) continue;
    const names = listing.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const name of names) {
      try {
        const rel = `wp-content/${sub}/${name}`;
        const r = await source.fileRead(rel);
        await dest.fileWrite(rel, r.content, { backup: false });
        copied += 1;
      } catch {
        // skip dir entries that aren't files
      }
    }
  }
  return {
    step: "wp_content",
    ok: true,
    detail: `${copied} top-level entries copied (deep tree sync deferred — use rsync for large media)`,
  };
}

async function rewriteUrls(
  dest: Target,
  sourceUrl: string,
  destUrl: string,
): Promise<CloneOutput["steps"][number]> {
  if (sourceUrl === destUrl) {
    return {
      step: "rewrite_urls",
      ok: true,
      detail: "source and dest siteurl match — skip",
    };
  }
  const srcHost = new URL(sourceUrl).host;
  const dstHost = new URL(destUrl).host;
  const r = await dest.wpCli(
    [
      "search-replace",
      srcHost,
      dstHost,
      "--all-tables",
      "--report-changed-only",
    ],
    { allowDestructive: true, timeoutMs: 120_000 },
  );
  if (r.exitCode !== 0) {
    return { step: "rewrite_urls", ok: false, detail: r.stderr.slice(0, 200) };
  }
  return {
    step: "rewrite_urls",
    ok: true,
    detail: `replaced ${srcHost} → ${dstHost}`,
  };
}

async function syncPluginVersions(
  source: Target,
  dest: Target,
): Promise<CloneOutput["steps"][number]> {
  const [src, dst] = await Promise.all([
    listPlugins(source),
    listPlugins(dest),
  ]);
  const dstMap = new Map(dst.map((p) => [p.name, p]));
  let synced = 0;
  for (const sp of src) {
    const dp = dstMap.get(sp.name);
    if (!dp || dp.version !== sp.version) {
      const r = await dest.wpCli(
        ["plugin", "install", sp.name, `--version=${sp.version}`, "--force"],
        {
          allowDestructive: true,
        },
      );
      if (r.exitCode === 0) synced += 1;
    }
  }
  return {
    step: "plugin_versions",
    ok: true,
    detail: `${synced} plugins synced`,
  };
}

async function listPlugins(
  t: Target,
): Promise<Array<{ name: string; version: string }>> {
  const r = await t.wpCli(["plugin", "list", "--format=json"]);
  if (r.exitCode !== 0) return [];
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return [];
  }
}
