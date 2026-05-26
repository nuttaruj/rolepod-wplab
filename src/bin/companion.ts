import { makeVault } from "../credentials/factory.js";
import { confirm } from "../credentials/prompt.js";
import { RestClient } from "../runtime/restClient.js";

/**
 * `rolepod-wplab companion <subcommand>`
 *
 *   install --target=<hostname>   Trigger remote installer.
 *     v1.1 scope: REST-based check + emit copy-paste wp-cli command.
 *     v1.2 will hit a companion-bootstrap proxy that streams the plugin zip.
 *   status  --target=<hostname>   Probe handshake + report capabilities.
 */
export async function runCompanion(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  switch (sub) {
    case "install":
      return runInstall(rest);
    case "status":
      return runStatus(rest);
    case undefined:
    case "--help":
    case "-h":
      printUsage();
      return sub === undefined ? 2 : 0;
    default:
      process.stderr.write(`[wplab] unknown companion subcommand: ${sub}\n`);
      printUsage();
      return 2;
  }
}

function printUsage(): void {
  process.stderr.write(
    `Usage: rolepod-wplab companion <install|status> --target=<hostname>\n` +
      `  install   probe target; emit copy-paste wp-cli install command\n` +
      `  status    probe handshake + print capabilities + production flag\n`,
  );
}

function parseTarget(args: string[]): string | null {
  for (const a of args) {
    if (a.startsWith("--target=")) return a.slice("--target=".length);
  }
  return null;
}

async function runInstall(args: string[]): Promise<number> {
  const target = parseTarget(args);
  if (!target) {
    process.stderr.write("error: --target=<hostname> required\n");
    return 2;
  }
  const ok = await confirm(
    `Probe https://${target} + emit installer command for companion plugin?`,
  );
  if (!ok) {
    process.stderr.write("aborted\n");
    return 1;
  }
  const probe = await probeHandshake(target);
  if (probe === "present") {
    process.stderr.write(`✓ companion already installed on ${target}\n`);
    return 0;
  }
  process.stderr.write(
    `○ no companion detected. Run this on the target host:\n\n`,
  );
  process.stderr.write(
    `  wp plugin install https://github.com/nuttaruj/rolepod-wplab-companion/releases/latest/download/rolepod-wplab-companion.zip --activate\n\n`,
  );
  process.stderr.write(
    `  Or, via the WP admin: Plugins → Add New → Upload Plugin → pick the zip.\n`,
  );
  process.stderr.write(
    `\n  After installing, run: rolepod-wplab companion status --target=${target}\n`,
  );
  return 0;
}

async function runStatus(args: string[]): Promise<number> {
  const target = parseTarget(args);
  if (!target) {
    process.stderr.write("error: --target=<hostname> required\n");
    return 2;
  }
  const status = await probeHandshake(target);
  if (status === "no_creds") {
    process.stderr.write(
      `✗ no stored credentials for ${target}. Run: rolepod-wplab credentials add ${target}\n`,
    );
    return 1;
  }
  if (status === "rest_fail") {
    process.stderr.write(
      `✗ REST auth failed for ${target} — credentials may be invalid\n`,
    );
    return 1;
  }
  if (status === "absent") {
    process.stderr.write(`○ companion NOT installed on ${target}\n`);
    return 1;
  }
  process.stderr.write(`✓ companion present on ${target}\n`);
  return 0;
}

async function probeHandshake(
  hostname: string,
): Promise<"present" | "absent" | "no_creds" | "rest_fail"> {
  const vault = await makeVault();
  const cred = await vault.get(hostname);
  if (!cred) return "no_creds";
  const client = new RestClient({
    baseUrl: `https://${hostname}`,
    credential: cred,
  });
  try {
    const auth = await client.request({
      method: "GET",
      path: "/wp/v2/types",
      timeoutMs: 8_000,
    });
    if (auth.status === 401 || auth.status === 403) return "rest_fail";
  } catch {
    return "rest_fail";
  }
  try {
    const hs = await client.request({
      method: "GET",
      path: "/wplab/v1/handshake",
      timeoutMs: 5_000,
    });
    return hs.status === 200 ? "present" : "absent";
  } catch {
    return "absent";
  }
}
