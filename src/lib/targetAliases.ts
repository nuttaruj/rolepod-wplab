/**
 * Target aliases — persistent name → siteurl + credential_ref map.
 *
 * Stored at `~/.config/rolepod-wplab/aliases.json` (mode 0600). Read at
 * tool-dispatch time when a tool call passes `target_id` like `@demo` —
 * the resolver looks up the alias, opens a fresh connect_rest session for
 * it (or reuses one cached in-memory), and threads the resolved target_id
 * into the tool call transparently.
 *
 * Why aliases? rolepod-wplab session ids are ephemeral (`tgt_<hex>`,
 * idle-closed after 10 min by TargetRegistry). Long builds repeatedly hit
 * `TARGET_NOT_FOUND` mid-flow. Aliases give a stable handle the AI can
 * keep referencing across the entire workflow.
 *
 * Storage is **separate** from the credentials vault — credentials are
 * keyed by canonical hostname, an alias is just a friendly pointer to one.
 */
import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  stat,
  access,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";

export const ALIAS_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;

const AliasSchema = z.object({
  alias: z
    .string()
    .regex(ALIAS_NAME_RE, "alias must be lowercase letters/digits/_/- starting with a letter"),
  siteurl: z.string().url(),
  credential_ref: z.string().min(1),
  added_at: z.string(),
  last_used_at: z.string().optional(),
});

const StoreSchema = z.object({
  version: z.literal(1),
  aliases: z.array(AliasSchema),
});

export type AliasEntry = z.infer<typeof AliasSchema>;
type Store = z.infer<typeof StoreSchema>;

export function defaultAliasFilePath(): string {
  const override = process.env["ROLEPOD_WPLAB_ALIASES_FILE"];
  if (override) return override;
  const base =
    process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
  return join(base, "rolepod-wplab", "aliases.json");
}

export class AliasStore {
  private readonly path: string;

  constructor(path: string = defaultAliasFilePath()) {
    this.path = path;
  }

  async list(): Promise<AliasEntry[]> {
    const s = await this.read();
    return [...s.aliases];
  }

  async get(alias: string): Promise<AliasEntry | null> {
    const s = await this.read();
    return s.aliases.find((a) => a.alias === alias) ?? null;
  }

  async set(entry: Omit<AliasEntry, "added_at" | "last_used_at">): Promise<AliasEntry> {
    const now = new Date().toISOString();
    const next: AliasEntry = AliasSchema.parse({
      alias: entry.alias,
      siteurl: entry.siteurl,
      credential_ref: entry.credential_ref,
      added_at: now,
    });
    const s = await this.read();
    const filtered = s.aliases.filter((a) => a.alias !== entry.alias);
    filtered.push(next);
    await this.write({ version: 1, aliases: filtered });
    return next;
  }

  async remove(alias: string): Promise<boolean> {
    const s = await this.read();
    const before = s.aliases.length;
    const filtered = s.aliases.filter((a) => a.alias !== alias);
    if (filtered.length === before) return false;
    await this.write({ version: 1, aliases: filtered });
    return true;
  }

  async touch(alias: string): Promise<void> {
    const s = await this.read();
    const idx = s.aliases.findIndex((a) => a.alias === alias);
    if (idx < 0) return;
    s.aliases[idx]!.last_used_at = new Date().toISOString();
    await this.write(s);
  }

  private async read(): Promise<Store> {
    try {
      await access(this.path, constants.R_OK);
    } catch {
      return { version: 1, aliases: [] };
    }
    const raw = await readFile(this.path, "utf8");
    try {
      return StoreSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error(`aliases file is corrupted: ${this.path}`);
    }
  }

  private async write(store: Store): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(store, null, 2), "utf8");
    try {
      await chmod(this.path, 0o600);
      const s = await stat(this.path);
      if ((s.mode & 0o777) !== 0o600) {
        process.stderr.write(
          `[wplab] warning: aliases file mode is ${(s.mode & 0o777).toString(8)}, expected 600. ` +
            "Filesystem may not support POSIX permissions.\n",
        );
      }
    } catch {
      /* chmod may fail on non-POSIX filesystems — best effort only */
    }
  }
}

export const ALIAS_PREFIX = "@";

export function looksLikeAlias(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(ALIAS_PREFIX) &&
    ALIAS_NAME_RE.test(value.slice(1))
  );
}

export function aliasNameFromValue(value: string): string {
  return value.startsWith(ALIAS_PREFIX) ? value.slice(1) : value;
}
