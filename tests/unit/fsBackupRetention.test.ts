import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  writeScopedFile,
  pruneBackups,
  backupKeepCount,
  BACKUP_KEEP_DEFAULT,
} from "../../src/runtime/fs.js";

const REL = "wp-content/themes/acme/functions.php";

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wplab-bak-"));
  await mkdir(join(root, "wp-content/themes/acme"), { recursive: true });
  return root;
}

async function backupsOf(root: string): Promise<string[]> {
  const names = await readdir(join(root, "wp-content/themes/acme"));
  return names.filter((n) => n.includes(".wplab-bak-")).sort();
}

describe("per-file backup retention", () => {
  let root: string;
  const savedEnv = process.env["ROLEPOD_WPLAB_BACKUP_KEEP"];

  beforeEach(async () => {
    root = await makeRoot();
    delete process.env["ROLEPOD_WPLAB_BACKUP_KEEP"];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env["ROLEPOD_WPLAB_BACKUP_KEEP"];
    else process.env["ROLEPOD_WPLAB_BACKUP_KEEP"] = savedEnv;
  });

  it("keeps only the newest 2 backups across repeated writes", async () => {
    for (const v of ["v1", "v2", "v3", "v4", "v5"]) {
      await writeScopedFile(root, REL, v, {});
    }

    const baks = await backupsOf(root);
    expect(baks).toHaveLength(BACKUP_KEEP_DEFAULT);

    // The survivors are the two most recent pre-write states: v3 and v4.
    const contents = await Promise.all(
      baks.map((n) =>
        readFile(join(root, "wp-content/themes/acme", n), "utf8"),
      ),
    );
    expect(contents.sort()).toEqual(["v3", "v4"]);
    expect(await readFile(join(root, REL), "utf8")).toBe("v5");
  });

  it("honours ROLEPOD_WPLAB_BACKUP_KEEP", async () => {
    process.env["ROLEPOD_WPLAB_BACKUP_KEEP"] = "3";
    expect(backupKeepCount()).toBe(3);

    for (const v of ["v1", "v2", "v3", "v4", "v5"]) {
      await writeScopedFile(root, REL, v, {});
    }
    expect(await backupsOf(root)).toHaveLength(3);
  });

  it("falls back to the default for a junk or zero override", async () => {
    process.env["ROLEPOD_WPLAB_BACKUP_KEEP"] = "0";
    expect(backupKeepCount()).toBe(BACKUP_KEEP_DEFAULT);
    process.env["ROLEPOD_WPLAB_BACKUP_KEEP"] = "not-a-number";
    expect(backupKeepCount()).toBe(BACKUP_KEEP_DEFAULT);
  });

  it("backup:false neither writes nor prunes", async () => {
    await writeScopedFile(root, REL, "v1", {});
    await writeScopedFile(root, REL, "v2", {});
    const before = await backupsOf(root);
    expect(before).toHaveLength(1);

    await writeScopedFile(root, REL, "v3", { backup: false });
    expect(await backupsOf(root)).toEqual(before);
  });

  it("never touches another file's backups or unrelated files", async () => {
    const dir = join(root, "wp-content/themes/acme");
    await writeFile(join(dir, "style.css"), "body{}", "utf8");
    await writeFile(join(dir, "style.css.wplab-bak-20200101-000000"), "a");
    await writeFile(join(dir, "style.css.wplab-bak-20200102-000000"), "b");
    await writeFile(join(dir, "style.css.wplab-bak-20200103-000000"), "c");
    await writeFile(join(dir, "notes.txt"), "keep me", "utf8");

    for (const v of ["v1", "v2", "v3", "v4"]) {
      await writeScopedFile(root, REL, v, {});
    }

    const names = await readdir(dir);
    expect(
      names.filter((n) => n.startsWith("style.css.wplab-bak-")),
    ).toHaveLength(3);
    expect(names).toContain("notes.txt");
    expect(
      names.filter((n) => n.startsWith("functions.php.wplab-bak-")),
    ).toHaveLength(2);
  });

  it("leaves a backup-of-a-backup out of the group", async () => {
    const dir = join(root, "wp-content/themes/acme");
    const nested = "functions.php.wplab-bak-A.wplab-bak-B";
    await writeFile(join(dir, nested), "nested", "utf8");
    await writeFile(join(dir, "functions.php"), "v0", "utf8");
    for (const v of ["v1", "v2", "v3"]) {
      await writeScopedFile(root, REL, v, {});
    }
    expect(await readdir(dir)).toContain(nested);
  });

  it("is a no-op when the file has no backups", async () => {
    await writeFile(join(root, REL), "v0", "utf8");
    expect(await pruneBackups(join(root, REL))).toEqual([]);
  });
});
