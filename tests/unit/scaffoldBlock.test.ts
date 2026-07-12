import { beforeEach, describe, expect, it, vi } from "vitest";
import { wpScaffoldBlockHandler } from "../../src/tools/composite/wp_scaffold_block.js";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

function harness() {
  const files: Record<string, string> = {};
  const target = {
    id: "tgt_blk00001",
    kind: "rest",
    siteurl: "https://x.test",
    companion: { enabled: true },
    fileWrite: vi.fn(async (path: string, content: string) => {
      files[path] = content;
      return { absolutePath: `/abs/${path}`, bytes: content.length };
    }),
  };
  const registry = { get: () => target } as unknown as TargetRegistry;
  return { registry, files };
}

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

function fileEndingWith(files: Record<string, string>, suffix: string): string {
  const key = Object.keys(files).find((k) => k.endsWith(suffix));
  return key ? files[key]! : "";
}

describe("wp_scaffold_block — no-build editor script (WS8-T3)", () => {
  it("emits browser-parseable index.js (no import, no JSX) using wp globals", async () => {
    const { registry, files } = harness();
    await wpScaffoldBlockHandler(registry, guard, {
      target_id: "tgt_blk00001",
      plugin_slug: "myplugin",
      block_slug: "my-team/card",
      title: "Card",
      allow_destructive: true,
    });
    const js = fileEndingWith(files, "/index.js");
    expect(js).not.toMatch(/\bimport\b/); // no ESM
    expect(js).not.toMatch(/<\w+[\s>]/); // no JSX tags
    expect(js).toContain("window.wp.blocks");
    expect(js).toContain("registerBlockType");
    expect(js).toContain("createElement");
    // dynamic block ⇒ save returns null
    expect(js).toMatch(/save:\s*function\s*\(\)\s*\{\s*return null/);
  });

  it("ships index.asset.php with the three script dependency handles", async () => {
    const { registry, files } = harness();
    await wpScaffoldBlockHandler(registry, guard, {
      target_id: "tgt_blk00001",
      plugin_slug: "myplugin",
      block_slug: "my-team/card",
      title: "Card",
      allow_destructive: true,
    });
    const asset = fileEndingWith(files, "/index.asset.php");
    expect(asset).toContain("wp-blocks");
    expect(asset).toContain("wp-block-editor");
    expect(asset).toContain("wp-element");
  });

  it("static block save() renders markup", async () => {
    const { registry, files } = harness();
    await wpScaffoldBlockHandler(registry, guard, {
      target_id: "tgt_blk00001",
      plugin_slug: "myplugin",
      block_slug: "my-team/card",
      title: "Card",
      render_strategy: "static",
      allow_destructive: true,
    });
    const js = fileEndingWith(files, "/index.js");
    expect(js).toContain("useBlockProps.save()");
  });

  it("render.php + index.js embed the title injection-safely", async () => {
    const { registry, files } = harness();
    await wpScaffoldBlockHandler(registry, guard, {
      target_id: "tgt_blk00001",
      plugin_slug: "myplugin",
      block_slug: "my-team/card",
      title: "Ev'il",
      allow_destructive: true,
    });
    const php = fileEndingWith(files, "/render.php");
    // phpQuote escapes the single quote → cannot break the PHP string literal.
    expect(php).toContain("'Ev\\'il'");
    expect(php).not.toContain("'Ev'il'");
    const js = fileEndingWith(files, "/index.js");
    // Embedded via JSON.stringify — the single quote sits safely inside the JS
    // double-quoted string, no breakout.
    expect(js).toContain('"Ev\'il (editor view)"');
  });
});
