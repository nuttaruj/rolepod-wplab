import { beforeEach, describe, expect, it, vi } from "vitest";

const { wpCptScaffoldHandler } =
  await import("../../src/tools/composite/wp_cpt_scaffold.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

interface Writes {
  path: string;
  content: string;
}

function harness(fileExists: boolean, restStatus = 200) {
  const writes: Writes[] = [];
  const wpCli = vi.fn(async () => ({ exitCode: 0, stdout: "", stderr: "" }));
  const target = {
    id: "tgt_cpt00001",
    kind: "rest" as const,
    siteurl: "https://x.test",
    companion: { enabled: true },
    wpCli,
    rest: vi.fn(async () => ({ status: restStatus, body: [], headers: {} })),
    fileRead: vi.fn(async () => {
      if (fileExists) return { content: "<?php", bytes: 5, absolutePath: "/x" };
      throw new Error("ENOENT");
    }),
    fileWrite: vi.fn(async (path: string, content: string) => {
      writes.push({ path, content });
      return { absolutePath: "/x", bytes: content.length };
    }),
  };
  const registry = { get: () => target } as unknown as TargetRegistry;
  return { registry, target, writes, wpCli };
}

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());

describe("wp_cpt_scaffold", () => {
  it("scaffolds the plugin, activates it, and verifies over REST", async () => {
    const { registry, writes, wpCli } = harness(false, 200);
    const out = await wpCptScaffoldHandler(registry, guard, {
      target_id: "tgt_cpt00001",
      slug: "portfolio",
      singular: "Portfolio Item",
      plural: "Portfolio",
    });
    expect(out).toMatchObject({
      slug: "portfolio",
      activated: true,
      rest_verified: true,
      rest_base: "portfolio",
      plugin_file:
        "wp-content/plugins/rolepod-cpt-portfolio/rolepod-cpt-portfolio.php",
    });
    // Wrote a plugin registering the CPT.
    expect(writes[0]?.content).toContain("register_post_type('portfolio'");
    expect(writes[0]?.content).toContain("flush_rewrite_rules()");
    // Activated the scaffolded plugin.
    expect(wpCli).toHaveBeenCalledWith(
      ["plugin", "activate", "rolepod-cpt-portfolio"],
      { allowDestructive: true },
    );
  });

  it("refuses to overwrite an existing scaffold", async () => {
    const { registry } = harness(true);
    await expect(
      wpCptScaffoldHandler(registry, guard, {
        target_id: "tgt_cpt00001",
        slug: "portfolio",
        singular: "Portfolio Item",
        plural: "Portfolio",
      }),
    ).rejects.toMatchObject({ code: "CPT_ALREADY_EXISTS" });
  });

  it("embeds labels injection-safely (phpQuote)", async () => {
    const { registry, writes } = harness(false);
    await wpCptScaffoldHandler(registry, guard, {
      target_id: "tgt_cpt00001",
      slug: "book",
      singular: "Bo'ok",
      plural: "Bo'oks",
    });
    // The single quote is escaped, never breaking the PHP string literal.
    expect(writes[0]?.content).toContain("'Bo\\'oks'");
    expect(writes[0]?.content).not.toContain("'Bo'oks'");
  });
});
