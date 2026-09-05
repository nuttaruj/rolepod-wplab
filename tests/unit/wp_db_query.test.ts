import { describe, expect, it, vi } from "vitest";
import { wpDbQueryHandler } from "../../src/tools/atomic/wp_db_query.js";
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

/**
 * `SELECT * FROM wp_posts` on a real site is hundreds of KB, and until 3.6.0
 * every byte reached the model. These pin the cap the handler applies and
 * prove it stays out of the target layer.
 */

function registryWith(stdout: string, stderr = "") {
  const wpCli = vi.fn(async () => ({
    exitCode: 0,
    stdout,
    stderr,
    durationMs: 1,
  }));
  const registry = {
    get: () => ({
      id: "tgt_db000001",
      kind: "local",
      siteurl: "https://x.test",
      wpCli,
    }),
  } as unknown as TargetRegistry;
  return { registry, wpCli };
}

const guard = new ProdGuard([]);

const TABLE = [
  "ID\tpost_title\tpost_content",
  ...Array.from(
    { length: 2000 },
    (_, i) => `${i}\tPost ${i}\t${"lorem ipsum ".repeat(20)}`,
  ),
].join("\n");

describe("wpDbQueryHandler — output cap (brief 14)", () => {
  it("returns a small result whole", async () => {
    const { registry } = registryWith("ID\n1\n2");
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_db000001",
      sql: "SELECT ID FROM wp_posts LIMIT 2",
    });
    expect(out.stdout).toBe("ID\n1\n2");
    expect(out.truncated).toBe(false);
    expect(out.total_bytes).toBe(out.returned_bytes);
  });

  it("caps a wide SELECT at 64 KB by default and keeps the header row", async () => {
    const { registry } = registryWith(TABLE);
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_db000001",
      sql: "SELECT * FROM wp_posts",
    });
    expect(out.truncated).toBe(true);
    expect(out.returned_bytes).toBeLessThanOrEqual(65_536);
    expect(out.total_bytes).toBe(Buffer.byteLength(TABLE));
    expect(out.stdout.startsWith("ID\tpost_title\tpost_content\n")).toBe(true);
  });

  it("honours max_bytes and caps stderr too", async () => {
    const { registry } = registryWith("a".repeat(500), "b".repeat(500));
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_db000001",
      sql: "SELECT 1",
      max_bytes: 20,
    });
    expect(out.stdout).toBe("a".repeat(20));
    expect(out.stderr).toBe("b".repeat(20));
    expect(out.returned_bytes).toBe(40);
    expect(out.total_bytes).toBe(1000);
    expect(out.truncated).toBe(true);
  });

  it("keeps the HPOS warning alongside the accounting fields", async () => {
    const { registry } = registryWith("");
    const out = await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_db000001",
      sql: "SELECT * FROM wp_posts WHERE post_type='shop_order'",
    });
    expect(out.warnings?.[0]).toMatch(/HPOS/);
    expect(out.truncated).toBe(false);
  });

  it("caps in the handler only — the target call is unchanged", async () => {
    const { registry, wpCli } = registryWith(TABLE);
    await wpDbQueryHandler(registry, guard, {
      target_id: "tgt_db000001",
      sql: "SELECT * FROM wp_posts",
      max_bytes: 10,
    });
    expect(wpCli).toHaveBeenCalledWith(
      [
        "db",
        "query",
        "SELECT * FROM wp_posts",
        "--skip-themes",
        "--skip-plugins",
      ],
      { allowDestructive: false },
    );
  });
});
