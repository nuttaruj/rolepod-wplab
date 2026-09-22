#!/usr/bin/env node
// Regenerates skills/index.json — the opencode HTTP skill catalog.
//
// opencode (v2) reads `skills: ["<base-url>/"]` from opencode.json, fetches
// `<base>/index.json`, then every listed file from `<base>/<name>/<file>`.
// Our base URL is the raw GitHub view of `skills/`, so this file must list
// every skill directory and every file inside it (SKILL.md plus the
// references/examples/templates the skill body points at). `version` is
// opencode's cache key; it follows package.json so a release refreshes the
// skills on the user's side without a config change.
//
// Run after adding, removing or renaming any file under skills/, and on every
// version bump:   npm run skills:index && rsync -a --delete skills/ plugins/rolepod-wplab/skills/
// tests/unit/opencodeSkillCatalog.test.ts fails until the file is current.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsDir = join(repoRoot, "skills");
const outFile = join(skillsDir, "index.json");
const version = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;

function walk(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, root));
    else out.push(relative(root, path).split("\\").join("/"));
  }
  return out;
}

const skills = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort()
  .map((name) => {
    const root = join(skillsDir, name);
    const files = walk(root, root);
    if (!files.includes("SKILL.md")) throw new Error(`${name}: no SKILL.md`);
    return {
      name,
      version,
      files: ["SKILL.md", ...files.filter((f) => f !== "SKILL.md")],
    };
  });

writeFileSync(outFile, `${JSON.stringify({ skills }, null, 2)}\n`);
console.log(`wrote ${relative(repoRoot, outFile)}: ${skills.length} skills, version ${version}`);
