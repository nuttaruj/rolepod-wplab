import { describe, expect, it, vi } from "vitest";
import { CompanionBridge } from "../../src/companion/Bridge.js";
import { CompanionUnavailableError, WplabError } from "../../src/util/errors.js";
import type { Target } from "../../src/runtime/Target.js";

interface RestReq {
  method: string;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
}
interface RestRes {
  status: number;
  body: unknown;
}

const HANDSHAKE = (caps: string[]): RestRes => ({
  status: 200,
  body: {
    companion_version: "2.13.0",
    wp_version: "6.9",
    siteurl: "https://staging.example.com",
    is_production: false,
    production_pattern_matched: null,
    capabilities: caps,
    session_token: "tok-" + Math.random().toString(36).slice(2),
    session_ttl_seconds: 1800,
  },
});

/** Build a fake Target whose rest() is driven by the supplied router. */
function mkTarget(router: (req: RestReq) => RestRes): Target {
  const rest = vi.fn(async (req: RestReq) => router(req));
  return {
    id: "t1",
    siteurl: "https://staging.example.com",
    rest,
  } as unknown as Target;
}

async function connectedBridge(
  caps: string[],
  router: (req: RestReq) => RestRes,
): Promise<CompanionBridge> {
  const target = mkTarget((req) =>
    req.method === "GET" && req.path === "/wplab/v1/handshake"
      ? HANDSHAKE(caps)
      : router(req),
  );
  const bridge = new CompanionBridge(target);
  await bridge.handshake();
  return bridge;
}

describe("CompanionBridge — skills", () => {
  it("throws CompanionUnavailableError when the skills capability is absent", async () => {
    const bridge = await connectedBridge([], () => ({ status: 200, body: {} }));
    await expect(bridge.skillCatalog()).rejects.toBeInstanceOf(CompanionUnavailableError);
  });

  it("skillCatalog returns the compact entry list", async () => {
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "GET" && req.path === "/wplab/v1/skills") {
        return {
          status: 200,
          body: {
            ok: true,
            skills: [
              { slug: "build-pages", name: "build-pages", description: "How we build pages", enable_agentic: true, enable_prompt: false },
            ],
          },
        };
      }
      return { status: 404, body: {} };
    });
    const skills = await bridge.skillCatalog();
    expect(skills).toHaveLength(1);
    expect(skills[0]!.slug).toBe("build-pages");
  });

  it("skillGet returns the record when found", async () => {
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "GET" && req.path === "/wplab/v1/skills/foo") {
        return {
          status: 200,
          body: {
            ok: true,
            found: true,
            slug: "foo",
            name: "foo",
            description: "d",
            content: "body",
            skill_md: "---\nname: foo\n---\n\nbody",
            enable_agentic: true,
            enable_prompt: false,
          },
        };
      }
      return { status: 404, body: {} };
    });
    const rec = await bridge.skillGet("foo");
    expect(rec).not.toBeNull();
    expect(rec!.content).toBe("body");
    expect(rec!.enable_prompt).toBe(false);
  });

  it("skillGet returns null when not found", async () => {
    const bridge = await connectedBridge(["skills"], () => ({
      status: 200,
      body: { ok: true, found: false, slug: "missing" },
    }));
    expect(await bridge.skillGet("missing")).toBeNull();
  });

  it("skillWrite passes through warnings + audit_id", async () => {
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "POST" && req.path === "/wplab/v1/skills") {
        expect(req.body!["session_token"]).toBeDefined();
        return {
          status: 200,
          body: { ok: true, slug: "my-skill", action: "created", warnings: ["Description is empty"], audit_id: "a1" },
        };
      }
      return { status: 404, body: {} };
    });
    const res = await bridge.skillWrite({ title: "My Skill", content: "x" });
    expect(res.action).toBe("created");
    expect(res.warnings).toContain("Description is empty");
    expect(res.audit_id).toBe("a1");
  });

  it("skillWrite surfaces collision repair hints in the error detail", async () => {
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "POST" && req.path === "/wplab/v1/skills") {
        return {
          status: 409,
          body: { ok: false, error_code: "SLUG_EXISTS", error_message: "exists", slug: "dup", suggested_slug: "dup-2" },
        };
      }
      return { status: 404, body: {} };
    });
    try {
      await bridge.skillWrite({ title: "dup", content: "x" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WplabError);
      const e = err as WplabError;
      expect(e.code).toBe("SLUG_EXISTS");
      // suggested_slug must reach the agent for one-shot self-correction
      expect(e.meta["suggested_slug"]).toBe("dup-2");
    }
  });

  it("skillWrite re-handshakes and retries once on 401", async () => {
    let posts = 0;
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "POST" && req.path === "/wplab/v1/skills") {
        posts++;
        return posts === 1
          ? { status: 401, body: { ok: false, error_code: "INVALID_OR_EXPIRED_TOKEN" } }
          : { status: 200, body: { ok: true, slug: "s", action: "created", warnings: [], audit_id: "a2" } };
      }
      return { status: 404, body: {} };
    });
    const res = await bridge.skillWrite({ title: "s", content: "x" });
    expect(posts).toBe(2);
    expect(res.audit_id).toBe("a2");
  });

  it("skillDelete sends the token as a query param and reports recoverable", async () => {
    const bridge = await connectedBridge(["skills"], (req) => {
      if (req.method === "DELETE" && req.path === "/wplab/v1/skills/foo") {
        expect(req.query!["session_token"]).toBeDefined();
        return { status: 200, body: { ok: true, slug: "foo", action: "trashed", recoverable: true, audit_id: "a3" } };
      }
      return { status: 404, body: {} };
    });
    const res = await bridge.skillDelete("foo");
    expect(res.action).toBe("trashed");
    expect(res.recoverable).toBe(true);
  });
});
