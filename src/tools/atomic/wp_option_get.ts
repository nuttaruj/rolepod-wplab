import {
  OptionGetInputSchema,
  OptionGetOutputSchema,
  type OptionGetInput,
  type OptionGetOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpOptionGetToolDef = {
  name: "rolepod_wp_option_get",
  description:
    "Read a WordPress option by name. Routes via wp-cli (LocalTarget) when available; falls back to REST /wp/v2/settings for the small allow-list WP exposes (siteurl, title, language, etc.).",
  inputSchema: OptionGetInputSchema,
};

export async function wpOptionGetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<OptionGetOutput> {
  const input: OptionGetInput = OptionGetInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // Prefer wp-cli when target has shell access (LocalTarget / SshTarget v0.3 / DockerTarget v0.3).
  if (
    target.kind === "local" ||
    target.kind === "ssh" ||
    target.kind === "docker"
  ) {
    try {
      const result = await target.wpCli([
        "option",
        "get",
        input.name,
        "--format=json",
      ]);
      if (result.exitCode === 0) {
        return OptionGetOutputSchema.parse({
          name: input.name,
          value: parseJsonSafe(result.stdout.trim()),
          source: "wp_cli",
        });
      }
      // exit_code 1 usually means option doesn't exist; return null value.
      return OptionGetOutputSchema.parse({
        name: input.name,
        value: null,
        source: "wp_cli",
      });
    } catch (err) {
      // wp-cli unavailable → fall through to REST.
      // We still throw if REST also fails.
      const _ignored = err as Error;
      void _ignored;
    }
  }

  // RestTarget OR wp-cli failed → try REST /wp/v2/settings (limited surface).
  const res = await target.rest({ method: "GET", path: "/wp/v2/settings" });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "OPTION_GET_FAILED",
      `REST settings returned HTTP ${res.status} — option may require wp-cli (install companion v0.2 for shared-hosting wp-cli proxy)`,
      { status: res.status, name: input.name },
    );
  }
  const settings = (res.body ?? {}) as Record<string, unknown>;
  return OptionGetOutputSchema.parse({
    name: input.name,
    value: settings[input.name] ?? null,
    source: "rest_settings",
  });
}

function parseJsonSafe(s: string): unknown {
  if (s === "") return null;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
