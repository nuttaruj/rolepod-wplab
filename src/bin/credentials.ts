import { makeVault } from "../credentials/factory.js";
import { ask, askSecret, confirm } from "../credentials/prompt.js";
import { canonicalizeSite } from "../credentials/types.js";

/**
 * `rolepod-wplab credentials <subcommand> [args]`
 *
 * Subcommands:
 *   add    <site>     Interactive add (prompts username + app password).
 *   list              List all stored credentials (metadata only).
 *   show   <site>     Show metadata for one site (no secret).
 *   remove <site>     Remove credentials for one site (confirm prompt).
 *   test   <site>     Validate that vault can read back the secret (no print).
 *
 * Returns process exit code: 0 success, 1 error, 2 usage error.
 */
export async function runCredentials(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  switch (sub) {
    case "add":
      return runAdd(rest);
    case "list":
      return runList();
    case "show":
      return runShow(rest);
    case "remove":
    case "rm":
      return runRemove(rest);
    case "test":
      return runTest(rest);
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return sub === undefined ? 2 : 0;
    default:
      process.stderr.write(`[wplab] unknown credentials subcommand: ${sub}\n`);
      printUsage();
      return 2;
  }
}

function printUsage(): void {
  process.stderr.write(
    `Usage: rolepod-wplab credentials <add|list|show|remove|test> [site]\n` +
      `  add    <site>     interactive add (prompts username + app password)\n` +
      `  list              list all stored credentials (no secrets)\n` +
      `  show   <site>     show metadata for one site (no secret)\n` +
      `  remove <site>     remove credentials for one site (confirm prompt)\n` +
      `  test   <site>     validate vault can read back the secret\n`,
  );
}

async function runAdd(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const canonical = canonicalizeSite(site);
  const vault = await makeVault();

  const existing = await vault.get(canonical);
  if (existing) {
    const overwrite = await confirm(
      `Credentials for ${canonical} already exist (user=${existing.username}). Overwrite?`,
    );
    if (!overwrite) {
      process.stderr.write("aborted\n");
      return 1;
    }
  }

  const username = await ask("Username: ");
  if (!username) {
    process.stderr.write("error: username required\n");
    return 1;
  }
  const appPassword = await askSecret("Application Password (hidden): ");
  if (!appPassword) {
    process.stderr.write("error: app password required\n");
    return 1;
  }

  await vault.add({
    site: canonical,
    username,
    appPassword,
    addedAt: new Date().toISOString(),
  });

  process.stderr.write(`✓ stored credentials for ${canonical}\n`);
  return 0;
}

async function runList(): Promise<number> {
  const vault = await makeVault();
  const entries = await vault.list();
  if (entries.length === 0) {
    process.stderr.write("(no credentials stored)\n");
    return 0;
  }
  for (const e of entries) {
    const last = e.lastUsedAt ? `, last_used=${e.lastUsedAt}` : "";
    process.stdout.write(
      `${e.site}\tuser=${e.username}\tsource=${e.source}\tadded=${e.addedAt}${last}\n`,
    );
  }
  return 0;
}

async function runShow(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const canonical = canonicalizeSite(site);
  const vault = await makeVault();
  const entries = await vault.list();
  const e = entries.find((x) => x.site === canonical);
  if (!e) {
    process.stderr.write(`no credentials stored for ${canonical}\n`);
    return 1;
  }
  process.stdout.write(JSON.stringify(e, null, 2) + "\n");
  return 0;
}

async function runRemove(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const canonical = canonicalizeSite(site);
  const ok = await confirm(`Remove credentials for ${canonical}?`);
  if (!ok) {
    process.stderr.write("aborted\n");
    return 1;
  }
  const vault = await makeVault();
  const removed = await vault.remove(canonical);
  if (!removed) {
    process.stderr.write(`no credentials found for ${canonical}\n`);
    return 1;
  }
  process.stderr.write(`✓ removed credentials for ${canonical}\n`);
  return 0;
}

async function runTest(args: string[]): Promise<number> {
  const site = args[0];
  if (!site) {
    process.stderr.write("error: site argument required\n");
    return 2;
  }
  const canonical = canonicalizeSite(site);
  const vault = await makeVault();
  const cred = await vault.get(canonical);
  if (!cred) {
    process.stderr.write(`no credentials stored for ${canonical}\n`);
    return 1;
  }
  // Validate shape; never print the secret.
  if (!cred.username || !cred.appPassword) {
    process.stderr.write(`credentials for ${canonical} are incomplete\n`);
    return 1;
  }
  await vault.touch(canonical);
  process.stderr.write(
    `✓ credentials for ${canonical} retrievable (user=${cred.username}, secret length=${cred.appPassword.length})\n`,
  );
  return 0;
}
