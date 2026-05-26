import { writeFileSync } from "node:fs";
import { MemoryStore } from "../memory/MemoryStore.js";
import { canonicalizeSite } from "../credentials/types.js";
import { confirm } from "../credentials/prompt.js";

/**
 * `rolepod-wplab memory <subcommand> [args]`
 *
 *   show   <site>           cat all notes
 *   list                    all stored sites
 *   clear  <site>           remove site dir (confirm prompt)
 *   export <site> [path]    export single markdown file
 */
export async function runMemory(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "show":
      return runShow(rest);
    case "list":
      return runList();
    case "clear":
      return runClear(rest);
    case "export":
      return runExport(rest);
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return sub === undefined ? 2 : 0;
    default:
      process.stderr.write(`[wplab] unknown memory subcommand: ${sub}\n`);
      printUsage();
      return 2;
  }
}

function printUsage(): void {
  process.stderr.write(
    `Usage: rolepod-wplab memory <show|list|clear|export> [args]\n` +
      `  show   <site>           print all stored notes for one site\n` +
      `  list                    list all sites with memory dirs\n` +
      `  clear  <site>           remove site dir (confirm prompt)\n` +
      `  export <site> [path]    export single markdown file; default stdout\n`,
  );
}

async function runShow(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const slug = canonicalizeSite(site);
  const text = await MemoryStore.export(slug);
  if (!text) {
    process.stderr.write(`no memory stored for ${slug}\n`);
    return 1;
  }
  process.stdout.write(text + "\n");
  return 0;
}

async function runList(): Promise<number> {
  const sites = await MemoryStore.listAllSites();
  if (sites.length === 0) {
    process.stderr.write("(no sites stored)\n");
    return 0;
  }
  for (const slug of sites) {
    const files = await MemoryStore.list(slug);
    const noteFile = files.find((f) => f.kind === "note");
    const mtime = noteFile?.mtime ?? files[0]?.mtime ?? "-";
    process.stdout.write(`${slug}\tfiles=${files.length}\tlast=${mtime}\n`);
  }
  return 0;
}

async function runClear(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const slug = canonicalizeSite(site);
  const ok = await confirm(`Remove memory dir for ${slug}?`);
  if (!ok) {
    process.stderr.write("aborted\n");
    return 1;
  }
  const removed = await MemoryStore.clear(slug);
  if (!removed) {
    process.stderr.write(`no memory stored for ${slug}\n`);
    return 1;
  }
  process.stderr.write(`✓ removed memory for ${slug}\n`);
  return 0;
}

async function runExport(args: string[]): Promise<number> {
  const site = args[0];
  const dest = args[1];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const slug = canonicalizeSite(site);
  const text = await MemoryStore.export(slug);
  if (!text) {
    process.stderr.write(`no memory stored for ${slug}\n`);
    return 1;
  }
  if (dest) {
    writeFileSync(dest, text + "\n", "utf8");
    process.stderr.write(`✓ exported to ${dest}\n`);
  } else {
    process.stdout.write(text + "\n");
  }
  return 0;
}
