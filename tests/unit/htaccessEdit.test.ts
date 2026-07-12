import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/companion/ledger.js", () => ({
  recordChange: vi.fn(async () => ({ auditId: "aud" })),
}));

const { wpHtaccessEditHandler } =
  await import("../../src/tools/composite/wp_htaccess_edit.js");
import { ProdGuard } from "../../src/safety/ProdGuard.js";
import type { TargetRegistry } from "../../src/target/TargetRegistry.js";

interface Opts {
  fetchStatuses?: number[]; // consumed in order across all fetch() calls
  innerLink?: string; // posts REST returns this link (or none)
  beforeExists?: boolean;
  siteurl?: string;
}

function harness(opts: Opts = {}) {
  const writes: Record<string, string> = {};
  const statuses = [...(opts.fetchStatuses ?? [200])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const status = statuses.length > 1 ? statuses.shift()! : statuses[0]!;
      return { status };
    }),
  );
  const target = {
    id: "tgt_hta00001",
    kind: "rest",
    siteurl: opts.siteurl ?? "https://x.test",
    companion: { enabled: true },
    wpCli: vi.fn(async (args: readonly string[]) =>
      args.join(" ").startsWith("core is-installed")
        ? { exitCode: 1, stdout: "", stderr: "", durationMs: 1 } // single site
        : { exitCode: 0, stdout: "", stderr: "", durationMs: 1 },
    ),
    rest: vi.fn(async () => ({
      status: 200,
      body: opts.innerLink ? [{ link: opts.innerLink }] : [],
      headers: {},
    })),
    fileRead: vi.fn(async () => {
      if (opts.beforeExists === false) throw new Error("ENOENT");
      return { content: "# old htaccess", bytes: 14, absolutePath: "/x" };
    }),
    fileWrite: vi.fn(async (path: string, content: string) => {
      writes[path] = content;
      return { absolutePath: `/abs/${path}`, bytes: content.length };
    }),
  };
  const registry = { get: () => target } as unknown as TargetRegistry;
  return { registry, writes, target };
}

const guard = new ProdGuard([]);
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("wp_htaccess_edit", () => {
  it("writes a sentinel .htaccess.bak + the new content when the probe is green", async () => {
    const { registry, writes } = harness({ fetchStatuses: [200] });
    const out = await wpHtaccessEditHandler(registry, guard, {
      target_id: "tgt_hta00001",
      content: "# new rules",
    });
    expect(writes[".htaccess.bak"]).toBe("# old htaccess");
    expect(writes[".htaccess"]).toBe("# new rules");
    expect(out).toMatchObject({
      written: true,
      rolled_back: false,
      health_ok: true,
    });
  });

  it("treats an inner-permalink 404 (root 200) as red and rolls back", async () => {
    // root 200, inner 404 (post-write); root 200 (post-restore reprobe).
    const { registry, writes } = harness({
      fetchStatuses: [200, 404, 200],
      innerLink: "https://x.test/hello-world",
    });
    const out = await wpHtaccessEditHandler(registry, guard, {
      target_id: "tgt_hta00001",
      content: "# broke rewrite",
    });
    expect(out).toMatchObject({
      written: false,
      rolled_back: true,
      health_ok: true,
    });
    // restored the original content
    expect(writes[".htaccess"]).toBe("# old htaccess");
  });

  it("reports rolled_back:false + manual recovery when the site stays down", async () => {
    // post-write root 500; post-restore root 500 (Apache down, restore can't help).
    const { registry } = harness({ fetchStatuses: [500, 500] });
    const out = await wpHtaccessEditHandler(registry, guard, {
      target_id: "tgt_hta00001",
      content: "# fatal",
    });
    expect(out).toMatchObject({ rolled_back: false, health_ok: false });
    expect(out.reason).toMatch(/\.htaccess\.bak/);
  });

  it("blocks a production target without confirm", async () => {
    const { registry } = harness({ siteurl: "https://prod.test" });
    await expect(
      wpHtaccessEditHandler(registry, new ProdGuard(["prod.test"]), {
        target_id: "tgt_hta00001",
        content: "# x",
      }),
    ).rejects.toMatchObject({ code: "PRODUCTION_BLOCKED" });
  });
});
