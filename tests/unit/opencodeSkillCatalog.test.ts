import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * opencode HTTP skill catalog guard.
 *
 * opencode (v2) loads skills from a `skills` config entry that points at an
 * HTTP base URL: it fetches `<base>/index.json`, then every listed file from
 * `<base>/<name>/<file>`, and caches each skill by `version`. Our base URL is
 * the raw GitHub view of `skills/`, so `skills/index.json` must mirror the
 * on-disk tree exactly — a skill dir without a catalog entry never reaches
 * opencode users, a listed file that is missing 404s on install, and an
 * unlisted references/ file leaves the model with a SKILL.md that points at
 * nothing. `version` follows package.json so a release refreshes the cache.
 *
 * Regenerate with:  npm run skills:index
 */
const repoRoot = resolve(__dirname, "..", "..");
const skillsDir = resolve(repoRoot, "skills");
const version = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8"),
).version as string;

type Entry = { name: string; version: string; files: string[] };
const catalog = JSON.parse(
  readFileSync(resolve(skillsDir, "index.json"), "utf8"),
) as { skills: Entry[] };

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split("\\").join("/"));
    }
  };
  walk(root);
  return out.sort();
}

const onDisk = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("skills/index.json (opencode HTTP catalog)", () => {
  it("lists exactly the skill directories under skills/", () => {
    const listed = catalog.skills.map((s) => s.name).sort();
    expect(listed).toEqual(onDisk);
    expect(new Set(listed).size).toBe(listed.length);
  });

  it.each(catalog.skills.map((s) => [s.name, s] as const))(
    "%s: files are the on-disk tree, SKILL.md first",
    (name, entry) => {
      expect(entry.files[0]).toBe("SKILL.md");
      for (const file of entry.files) {
        // opencode requires safe, relative, same-origin paths.
        expect(file.startsWith("/")).toBe(false);
        expect(file.includes("..")).toBe(false);
      }
      expect([...entry.files].sort()).toEqual(tree(join(skillsDir, name)));
    },
  );

  it.each(catalog.skills.map((s) => [s.name, s.version] as const))(
    "%s: catalog version tracks package.json (opencode cache key)",
    (_name, v) => {
      expect(v).toBe(version);
    },
  );
});
