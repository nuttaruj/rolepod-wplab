import { beforeEach, describe, expect, it, vi } from "vitest";

// Capture what the scaffold writes without touching a real target.
const writes: Record<string, string> = {};
vi.mock("../../src/companion/managedWrite.js", () => ({
  writeManagedFile: vi.fn(
    async (_t: unknown, path: string, content: string) => {
      writes[path] = content;
      return {
        bytesWritten: content.length,
        backupPath: null,
        absolutePath: path,
      };
    },
  ),
}));

const { wpScaffoldPluginHandler } =
  await import("../../src/tools/composite/wp_scaffold_plugin.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

const registry = {
  get: () => ({ id: "tgt_sp000001", kind: "rest", siteurl: "https://x.test" }),
} as unknown as TargetRegistry;
const guard = new ProdGuard([]);

beforeEach(() => {
  for (const k of Object.keys(writes)) delete writes[k];
  vi.clearAllMocks();
});

function fileEndingWith(suffix: string): string {
  const key = Object.keys(writes).find((k) => k.endsWith(suffix));
  return key ? writes[key]! : "";
}

describe("wp_scaffold_plugin — injection-safe PHP embedding (WS8-T4)", () => {
  it("phpQuotes the plugin name in the admin-page + docblock, escaping quotes", async () => {
    await wpScaffoldPluginHandler(registry, guard, {
      target_id: "tgt_sp000001",
      slug: "my-plugin",
      name: "Ev'il */ Plugin",
      features: ["admin_page", "cli_command"],
      allow_destructive: true,
    });

    const admin = fileEndingWith("/inc/admin-page.php");
    // The single quote is backslash-escaped inside a PHP single-quoted literal.
    expect(admin).toContain("'Ev\\'il */ Plugin'");
    // No raw unescaped breakout.
    expect(admin).not.toContain("'Ev'il");

    const main = fileEndingWith("/my-plugin.php");
    // The docblock `*/` is neutralized so it cannot close the comment early.
    expect(main).toContain("* /");
    expect(main).not.toMatch(/Plugin Name:.*\*\/ Plugin/);

    const cli = fileEndingWith("/inc/cli.php");
    expect(cli).toContain("'Ev\\'il */ Plugin: hello from CLI'");
  });
});
