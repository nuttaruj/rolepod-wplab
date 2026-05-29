import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

/**
 * Structured project-convention storage.
 *
 * Persists a per-site style guide that AI references on subsequent sessions
 * so design decisions stay consistent across chats (colors, fonts, spacing,
 * naming rules, code conventions).
 *
 * Storage: `~/.config/rolepod-wplab/memory/<site>/conventions.json`.
 * Same root as `memory_*` tools but structured (not free-form text) so the
 * model can read individual keys without re-parsing.
 */

const ConventionsSchema = z.object({
  colors: z
    .array(
      z.object({
        slug: z.string(),
        name: z.string().optional(),
        hex: z.string(),
        usage: z.string().optional(),
      }),
    )
    .optional(),
  fonts: z
    .array(
      z.object({
        slug: z.string(),
        family: z.string(),
        weights: z.array(z.number()).optional(),
        usage: z.string().optional(),
      }),
    )
    .optional(),
  spacing: z
    .array(
      z.object({
        slug: z.string(),
        size: z.string(),
        usage: z.string().optional(),
      }),
    )
    .optional(),
  style_rules: z.array(z.string()).optional(),
  code_conventions: z.array(z.string()).optional(),
  brand_voice: z.string().optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const ConventionsGetInputSchema = z.object({
  target_id: z.string(),
});

export const ConventionsSetInputSchema = z.object({
  target_id: z.string(),
  conventions: ConventionsSchema,
  merge: z.boolean().default(true),
});

export const wpConventionsGetToolDef = {
  name: "rolepod_wp_conventions_get",
  description:
    "Read the per-site project conventions (colors, fonts, spacing, style rules, code conventions, brand voice). Persisted between sessions at ~/.config/rolepod-wplab/memory/<site>/conventions.json so design decisions stay consistent across AI sessions.",
  inputSchema: ConventionsGetInputSchema,
};

export const wpConventionsSetToolDef = {
  name: "rolepod_wp_conventions_set",
  description:
    "Write the per-site project conventions. By default merges with existing values (merge: true); pass merge: false to replace wholesale. Saves to ~/.config/rolepod-wplab/memory/<site>/conventions.json.",
  inputSchema: ConventionsSetInputSchema,
};

function conventionsPath(siteurl: string): string {
  const host = new URL(siteurl).host;
  return join(
    homedir(),
    ".config",
    "rolepod-wplab",
    "memory",
    host,
    "conventions.json",
  );
}

export async function wpConventionsGetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ConventionsGetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const path = conventionsPath(target.siteurl);
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false, conventions: null };
    }
    throw err;
  }
}

export async function wpConventionsSetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<unknown> {
  const input = ConventionsSetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const path = conventionsPath(target.siteurl);

  let existing: z.infer<typeof ConventionsSchema> = {};
  if (input.merge) {
    try {
      const content = await readFile(path, "utf8");
      existing = JSON.parse(content);
    } catch {
      /* file doesn't exist yet */
    }
  }

  const merged = input.merge
    ? { ...existing, ...input.conventions }
    : input.conventions;

  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(merged, null, 2), { mode: 0o600 });

  return {
    ok: true,
    path,
    keys: Object.keys(merged),
    merge: input.merge,
  };
}
