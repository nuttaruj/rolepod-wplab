import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface OxygenPageSummary {
  id: number;
  title: string;
  status: string;
  has_oxygen: boolean;
}

export interface OxygenPageDetail {
  id: number;
  title: string;
  shortcodes: string;
  json_slug: string | null;
  other_template: string | null;
  bytes: number;
}

export interface OxygenReadAPI {
  listPages(
    target: Target,
    opts?: { type?: string; per_page?: number },
  ): Promise<OxygenPageSummary[]>;
  getPage(target: Target, postId: number): Promise<OxygenPageDetail>;
}

const SLUG = "oxygen";

export const oxygenAdapter: Adapter<OxygenReadAPI> = {
  slug: SLUG,
  name: "Oxygen Builder",
  supportedRange: { min: "4.5", testedUpTo: "4.8" },

  async detect(target: Target): Promise<boolean> {
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli(["plugin", "is-active", "oxygen"]);
        return r.exitCode === 0;
      } catch {
        return false;
      }
    }
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        return Object.keys(body.routes).some((r) => r.startsWith("/oxygen/"));
      }
    } catch {
      // ignore
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
        query: { per_page, _fields: "id,title,status,meta" },
      });
      const items = Array.isArray(res.body) ? res.body : [];
      return items.map((raw) => {
        const p = raw as {
          id: number;
          title: { rendered: string };
          status: string;
          meta?: Record<string, unknown>;
        };
        return {
          id: p.id,
          title: p.title.rendered,
          status: p.status,
          has_oxygen:
            typeof p.meta?.["ct_builder_shortcodes"] === "string" &&
            (p.meta["ct_builder_shortcodes"] as string).length > 0,
        };
      });
    },

    async getPage(target, postId) {
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const sc = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "ct_builder_shortcodes",
        ]);
        const slug = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "ct_builder_json_slug",
        ]);
        const other = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "ct_other_template",
        ]);
        const title = await target.wpCli([
          "post",
          "get",
          String(postId),
          "--field=post_title",
        ]);
        const shortcodes = sc.exitCode === 0 ? sc.stdout : "";
        return {
          id: postId,
          title: title.exitCode === 0 ? title.stdout.trim() : "",
          shortcodes,
          json_slug:
            slug.exitCode === 0 && slug.stdout.trim()
              ? slug.stdout.trim()
              : null,
          other_template:
            other.exitCode === 0 && other.stdout.trim()
              ? other.stdout.trim()
              : null,
          bytes: shortcodes.length,
        };
      }
      throw new Error(
        "oxygen.getPage on RestTarget requires companion v0.2 (post meta access).",
      );
    },
  },
};
