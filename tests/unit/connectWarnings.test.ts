import { describe, it, expect } from "vitest";
import { collectConnectWarnings } from "../../src/lib/connectWarnings.js";
import type { Target } from "../../src/runtime/Target.js";

function fakeTarget(restBody: unknown): Target {
  return {
    id: "tgt_test1234",
    kind: "rest",
    siteurl: "https://example.com",
    wpVersion: "7.0",
    companion: null,
    rest: async () => ({
      status: 200,
      body: restBody,
      headers: {},
    }),
    rootPath: () => "https://example.com",
    wpCli: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
    fileRead: async () => ({ content: "", bytes: 0, absolutePath: "" }),
    fileWrite: async () => ({
      bytesWritten: 0,
      backupPath: null,
      absolutePath: "",
    }),
    fileExists: async () => false,
    close: async () => {},
  } as unknown as Target;
}

/** Target that routes per-path responses (handles both detectors at once). */
function routedTarget(
  routes: Record<string, { status: number; body: unknown }>,
): Target {
  return {
    id: "tgt_test1234",
    kind: "rest",
    siteurl: "https://example.com",
    wpVersion: "7.0",
    companion: null,
    rest: async (req) => {
      const key = req.path.split("?")[0]!;
      const r = routes[key] ?? { status: 404, body: { code: "rest_no_route" } };
      return { status: r.status, body: r.body, headers: {} };
    },
    rootPath: () => "https://example.com",
    wpCli: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
    fileRead: async () => ({ content: "", bytes: 0, absolutePath: "" }),
    fileWrite: async () => ({
      bytesWritten: 0,
      backupPath: null,
      absolutePath: "",
    }),
    fileExists: async () => false,
    close: async () => {},
  } as unknown as Target;
}

describe("siteurlSchemeMismatch detector", () => {
  it("warns when site serves https but siteurl stored is http", async () => {
    const target = fakeTarget({ url: "http://example.com" });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe("siteurl_http_but_site_https");
    expect(warnings[0]!.suggested_fix).toContain("siteurl");
  });

  it("does not warn when siteurl already https", async () => {
    const target = fakeTarget({ url: "https://example.com" });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when connect URL is http (cannot prove https-only)", async () => {
    const target = fakeTarget({ url: "http://example.com" });
    const warnings = await collectConnectWarnings(target, "http://example.com");
    expect(warnings).toHaveLength(0);
  });

  it("does not warn when host differs", async () => {
    const target = fakeTarget({ url: "http://other.com" });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    expect(warnings).toHaveLength(0);
  });
});

describe("blockThemeBodyOpen detector", () => {
  it("warns when active theme reports is_block_theme=true", async () => {
    const target = routedTarget({
      "/wp/v2/settings": { status: 200, body: { url: "https://example.com" } },
      "/wp/v2/themes": {
        status: 200,
        body: [{ stylesheet: "twentytwentyfive", is_block_theme: true }],
      },
    });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    const blockWarn = warnings.find(
      (w) => w.code === "block_theme_body_open_risk",
    );
    expect(blockWarn).toBeDefined();
    expect(blockWarn!.message).toContain("twentytwentyfive");
  });

  it("does not warn when active theme is classic", async () => {
    const target = routedTarget({
      "/wp/v2/settings": { status: 200, body: { url: "https://example.com" } },
      "/wp/v2/themes": {
        status: 200,
        body: [{ stylesheet: "hello-elementor", is_block_theme: false }],
      },
    });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    expect(
      warnings.find((w) => w.code === "block_theme_body_open_risk"),
    ).toBeUndefined();
  });

  it("absorbs themes-endpoint failure silently", async () => {
    const target = routedTarget({
      "/wp/v2/settings": { status: 200, body: { url: "https://example.com" } },
      // /wp/v2/themes returns the default 404
    });
    const warnings = await collectConnectWarnings(
      target,
      "https://example.com",
    );
    // Should still complete successfully, just without the block-theme warning.
    expect(
      warnings.find((w) => w.code === "block_theme_body_open_risk"),
    ).toBeUndefined();
  });
});
