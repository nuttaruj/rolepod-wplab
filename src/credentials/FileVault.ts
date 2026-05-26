import {
  readFile,
  writeFile,
  mkdir,
  chmod,
  stat,
  access,
} from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Credential, CredentialMeta, Vault } from "./types.js";

const CredentialSchema = z.object({
  site: z.string(),
  username: z.string(),
  appPassword: z.string(),
  addedAt: z.string(),
  lastUsedAt: z.string().optional(),
});

const StoreSchema = z.object({
  version: z.literal(1),
  entries: z.array(CredentialSchema),
});

type Store = z.infer<typeof StoreSchema>;

/**
 * Credential vault backed by a single JSON file at mode 0600.
 *
 * Primary use: Linux + Windows (no native keychain in v0.0). macOS uses
 * KeychainVault by default but FileVault is a valid fallback when keychain
 * is unavailable (e.g. SSH-without-Mac-login session).
 */
export class FileVault implements Vault {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async add(c: Credential): Promise<void> {
    const store = await this.read();
    const filtered = store.entries.filter((e) => e.site !== c.site);
    filtered.push(c);
    await this.write({ version: 1, entries: filtered });
  }

  async get(site: string): Promise<Credential | null> {
    const store = await this.read();
    const e = store.entries.find((x) => x.site === site);
    if (!e) return null;
    return {
      site: e.site,
      username: e.username,
      appPassword: e.appPassword,
      addedAt: e.addedAt,
      ...(e.lastUsedAt !== undefined ? { lastUsedAt: e.lastUsedAt } : {}),
    };
  }

  async list(): Promise<CredentialMeta[]> {
    const store = await this.read();
    return store.entries.map((e) => {
      const meta: CredentialMeta = {
        site: e.site,
        username: e.username,
        addedAt: e.addedAt,
        source: "file",
      };
      if (e.lastUsedAt !== undefined) meta.lastUsedAt = e.lastUsedAt;
      return meta;
    });
  }

  async remove(site: string): Promise<boolean> {
    const store = await this.read();
    const before = store.entries.length;
    const filtered = store.entries.filter((e) => e.site !== site);
    if (filtered.length === before) return false;
    await this.write({ version: 1, entries: filtered });
    return true;
  }

  async touch(site: string): Promise<void> {
    const store = await this.read();
    const idx = store.entries.findIndex((e) => e.site === site);
    if (idx < 0) return;
    store.entries[idx]!.lastUsedAt = new Date().toISOString();
    await this.write(store);
  }

  private async read(): Promise<Store> {
    try {
      await access(this.path, constants.R_OK);
    } catch {
      return { version: 1, entries: [] };
    }
    const raw = await readFile(this.path, "utf8");
    try {
      return StoreSchema.parse(JSON.parse(raw));
    } catch {
      // Corrupted file — refuse to overwrite, fail loudly.
      throw new Error(`credentials file is corrupted: ${this.path}`);
    }
  }

  private async write(store: Store): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(store, null, 2), "utf8");
    await chmod(this.path, 0o600);
    // Best-effort: warn if mode didn't stick (some filesystems ignore chmod).
    const s = await stat(this.path);
    const mode = s.mode & 0o777;
    if (mode !== 0o600) {
      process.stderr.write(
        `[wplab] warning: credentials file mode is ${mode.toString(8)}, expected 600. ` +
          "Filesystem may not support POSIX permissions. Manually restrict access.\n",
      );
    }
  }
}
