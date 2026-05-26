import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface BricksPageSummary {
  id: number;
  title: string;
  status: string;
}

export interface BricksElement {
  id: string;
  name: string;
  parent?: string;
  settings?: Record<string, unknown>;
}

export interface BricksPageDetail {
  id: number;
  title: string;
  elements: BricksElement[];
  meta_size_bytes: number;
}

export interface BricksReadAPI {
  /** List Bricks-rendered pages (header/footer/content templates, plus pages). */
  listPages(
    target: Target,
    opts?: { type?: string; per_page?: number },
  ): Promise<BricksPageSummary[]>;

  /** Dump element tree from `_bricks_page_content_2` post meta. */
  getPage(target: Target, postId: number): Promise<BricksPageDetail>;
}

const SLUG = "bricks";

export const bricksAdapter: Adapter<BricksReadAPI> = {
  slug: SLUG,
  name: "Bricks Builder",
  supportedRange: { min: "1.8", testedUpTo: "1.10" },

  async detect(target: Target): Promise<boolean> {
    // Bricks registers `/bricks/v1/` REST routes (Bricks Builder API).
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        if (Object.keys(body.routes).some((r) => r.startsWith("/bricks/")))
          return true;
      }
    } catch {
      // fall through
    }
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli(["theme", "is-active", "bricks"]);
        if (r.exitCode === 0) return true;
        // Bricks-child also valid
        const r2 = await target.wpCli(["theme", "is-active", "bricks-child"]);
        return r2.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  },

  read: {
    async listPages(target, opts = {}) {
      const type = opts.type ?? "page";
      const per_page = opts.per_page ?? 50;
      const res = await target.rest({
        method: "GET",
        path: `/wp/v2/${type}`,
        query: { per_page, _fields: "id,title,status,link" },
      });
      const items = Array.isArray(res.body) ? res.body : [];
      return items.map((raw) => {
        const p = raw as {
          id: number;
          title: { rendered: string };
          status: string;
        };
        return { id: p.id, title: p.title.rendered, status: p.status };
      });
    },

    async getPage(target, postId) {
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const meta = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "_bricks_page_content_2",
          "--format=json",
        ]);
        if (meta.exitCode !== 0) {
          return { id: postId, title: "", elements: [], meta_size_bytes: 0 };
        }
        const elements = JSON.parse(meta.stdout) as BricksElement[];
        const title = await target.wpCli([
          "post",
          "get",
          String(postId),
          "--field=post_title",
        ]);
        return {
          id: postId,
          title: title.exitCode === 0 ? title.stdout.trim() : "",
          elements,
          meta_size_bytes: meta.stdout.length,
        };
      }
      throw new Error(
        "bricks.getPage on RestTarget requires companion v0.2 (post meta access).",
      );
    },
  },
};
