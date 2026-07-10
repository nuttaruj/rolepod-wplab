import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `skills/` is the source of truth. `plugins/rolepod-wplab/skills/` is the copy
 * that ships to Claude Code plugin users — a real copy, not a symlink (see
 * 39c6b87). They drifted apart: the shipped tree was missing the whole
 * `wp-edit-design/references/` directory, so plugin users read a different set
 * of instructions than this repo's tests check.
 *
 * Re-sync with:
 *   rsync -a --delete skills/ plugins/rolepod-wplab/skills/
 */
const SOURCE = "skills";
const SHIPPED = "plugins/rolepod-wplab/skills";

function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path));
    }
  };
  walk(root);
  return out.sort();
}

describe("skill parity — the shipped tree matches the source tree", () => {
  const sourceFiles = tree(SOURCE);
  const shippedFiles = tree(SHIPPED);

  it("ships every source file, and no extra ones", () => {
    expect(shippedFiles).toEqual(sourceFiles);
  });

  it.each(tree(SOURCE))("%s is byte-identical", (rel) => {
    expect(readFileSync(join(SHIPPED, rel), "utf8")).toBe(
      readFileSync(join(SOURCE, rel), "utf8"),
    );
  });
});
