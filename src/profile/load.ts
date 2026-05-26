import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { log } from "../util/log.js";

export const ProfileSchema = z.enum(["strict", "personal", "power"]);
export type Profile = z.infer<typeof ProfileSchema>;

export const ProfileConfigSchema = z.object({
  profile: ProfileSchema.default("strict"),
  production_hosts: z.array(z.string()).default([]),
  default_target_path: z.string().optional(),
  companion: z
    .object({
      require_installed: z.boolean().default(false),
      session_ttl_seconds: z.number().int().positive().default(1800),
    })
    .default({}),
});

export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;

function defaultConfigPath(): string {
  const override = process.env["ROLEPOD_WPLAB_CONFIG"];
  if (override) return override;
  return join(homedir(), ".config", "rolepod-wplab", "profile.json");
}

export function loadProfile(): ProfileConfig {
  const path = defaultConfigPath();

  let fromFile: Partial<ProfileConfig> = {};
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const parsed: unknown = JSON.parse(raw);
      fromFile = ProfileConfigSchema.parse(parsed);
    } catch (err) {
      log.warn(`Failed to load profile from ${path} — using defaults`, {
        err: (err as Error).message,
      });
    }
  }

  const envProfile = process.env["ROLEPOD_WPLAB_PROFILE"];
  const envProdHosts = process.env["ROLEPOD_WPLAB_PROD_HOSTS"];

  const merged = ProfileConfigSchema.parse({
    profile: envProfile ?? fromFile.profile ?? "strict",
    production_hosts: envProdHosts
      ? envProdHosts
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : (fromFile.production_hosts ?? []),
    default_target_path: fromFile.default_target_path,
    companion: fromFile.companion ?? {},
  });

  return merged;
}
