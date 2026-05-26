import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeVault } from "../credentials/factory.js";
import { ask, askSecret, confirm } from "../credentials/prompt.js";
import { canonicalizeSite } from "../credentials/types.js";
import { RestClient } from "../runtime/restClient.js";

/**
 * `rolepod-wplab init` — interactive setup wizard.
 *
 * Walks the user through:
 *   1. site URL + Application Password registration
 *   2. companion handshake probe
 *   3. write a starter profile.json under ~/.config/rolepod-wplab/
 *   4. emit copy-paste MCP install command for the user's AI CLI
 */
export async function runInit(_argv: string[]): Promise<number> {
  process.stderr.write(
    "rolepod-wplab init — let's wire up your first WordPress target.\n\n",
  );

  const urlInput = await ask("Site URL (https://...): ");
  if (!urlInput.startsWith("https://")) {
    process.stderr.write("error: must start with https://\n");
    return 1;
  }
  let url: URL;
  try {
    url = new URL(urlInput);
  } catch {
    process.stderr.write("error: invalid URL\n");
    return 1;
  }

  const canonical = canonicalizeSite(url.host);
  process.stderr.write(`Canonical site key: ${canonical}\n\n`);

  const username = await ask("WP username: ");
  if (!username) {
    process.stderr.write("error: username required\n");
    return 1;
  }
  process.stderr.write(
    `Create an Application Password at:\n  ${url.origin}/wp-admin/profile.php#application-passwords-section\n` +
      `Name it "rolepod-wplab", then paste it below.\n\n`,
  );
  const appPassword = await askSecret("Application Password: ");
  if (!appPassword) {
    process.stderr.write("error: app password required\n");
    return 1;
  }

  process.stderr.write("\nProbing REST + companion...\n");
  const client = new RestClient({
    baseUrl: url.origin,
    credential: {
      site: canonical,
      username,
      appPassword,
      addedAt: new Date().toISOString(),
    },
  });

  const probe = await client.request({
    method: "GET",
    path: "/wp/v2/types",
    timeoutMs: 10_000,
  });
  if (probe.status === 401 || probe.status === 403) {
    process.stderr.write(
      `✗ REST auth failed (HTTP ${probe.status}). Check username + App Password.\n`,
    );
    return 1;
  }
  if (probe.status < 200 || probe.status >= 300) {
    process.stderr.write(
      `✗ REST probe returned HTTP ${probe.status}. Site may not have REST enabled.\n`,
    );
    return 1;
  }
  process.stderr.write(`✓ REST reachable\n`);

  const hs = await client.request({
    method: "GET",
    path: "/wplab/v1/handshake",
    timeoutMs: 5_000,
  });
  let companionVersion: string | null = null;
  if (hs.status === 200 && hs.body && typeof hs.body === "object") {
    companionVersion =
      (hs.body as { companion_version?: string }).companion_version ?? null;
    process.stderr.write(
      `✓ Companion present (v${companionVersion ?? "unknown"})\n`,
    );
  } else {
    process.stderr.write(
      `○ No companion plugin (rest_ok only; install rolepod-wp later for power tools)\n`,
    );
  }

  const saveCreds = await confirm("\nStore credentials in the local vault?");
  if (saveCreds) {
    const vault = await makeVault();
    await vault.add({
      site: canonical,
      username,
      appPassword,
      addedAt: new Date().toISOString(),
    });
    process.stderr.write(`✓ stored in vault\n`);
  }

  const xdgConfig =
    process.env["XDG_CONFIG_HOME"] ??
    join(process.env["HOME"] ?? ".", ".config");
  const profileDir = join(xdgConfig, "rolepod-wplab");
  if (!existsSync(profileDir)) {
    await mkdir(profileDir, { recursive: true });
  }
  const profilePath = join(profileDir, "profile.json");
  if (!existsSync(profilePath)) {
    await writeFile(
      profilePath,
      JSON.stringify(
        {
          profile: "personal",
          production_hosts: [],
          default_target: canonical,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    process.stderr.write(`✓ wrote starter ${profilePath} (profile=personal)\n`);
  }

  process.stderr.write(
    "\nDone! Next steps:\n\n" +
      "  Claude Code:\n" +
      "    claude mcp add rolepod-wplab -- rolepod-wplab serve\n\n" +
      "  Cursor:\n" +
      '    Settings → MCP → Add server → { "command": "rolepod-wplab", "args": ["serve"] }\n\n' +
      "  Then in your AI CLI:\n" +
      `    "Connect to ${url.host} and run health_check."\n\n`,
  );
  return 0;
}
