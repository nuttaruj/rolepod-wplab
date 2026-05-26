import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface YoastPostMeta {
  post_id: number;
  focus_keyword?: string;
  meta_description?: string;
  title?: string;
  canonical?: string;
  noindex?: boolean;
}

export interface YoastReadAPI {
  /** Yoast SEO meta for a single post via REST. */
  postMeta(target: Target, postId: number): Promise<YoastPostMeta>;
  /** Yoast settings (titles, schema) via wp-cli. */
  settings(target: Target): Promise<unknown>;
}

const SLUG = "yoast";

export const yoastAdapter: Adapter<YoastReadAPI> = {
  slug: SLUG,
  name: "Yoast SEO",
  supportedRange: { min: "21.0", testedUpTo: "23.5" },

  async detect(target: Target): Promise<boolean> {
    try {
      const res = await target.rest({ method: "GET", path: "/" });
      const body = res.body as { routes?: Record<string, unknown> } | undefined;
      if (body?.routes && typeof body.routes === "object") {
        if (Object.keys(body.routes).some((r) => r.startsWith("/yoast/v1")))
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
        const r = await target.wpCli(["plugin", "is-active", "wordpress-seo"]);
        return r.exitCode === 0;
      } catch {
        return false;
      }
    }
    return false;
  },

  read: {
    async postMeta(target, postId) {
      // Yoast exposes SEO meta via /wp/v2/posts/{id}?_fields=yoast_head_json
      const res = await target.rest({
        method: "GET",
        path: `/wp/v2/posts/${postId}`,
        query: { _fields: "id,yoast_head_json,meta" },
      });
      const body = (res.body ?? {}) as {
        id?: number;
        yoast_head_json?: {
          description?: string;
          title?: string;
          canonical?: string;
          robots?: { index?: string };
        };
        meta?: Record<string, unknown>;
      };
      const yhj = body.yoast_head_json ?? {};
      const meta = body.meta ?? {};
      const out: YoastPostMeta = { post_id: postId };
      if (typeof meta["_yoast_wpseo_focuskw"] === "string")
        out.focus_keyword = meta["_yoast_wpseo_focuskw"];
      if (typeof yhj.description === "string")
        out.meta_description = yhj.description;
      if (typeof yhj.title === "string") out.title = yhj.title;
      if (typeof yhj.canonical === "string") out.canonical = yhj.canonical;
      if (yhj.robots?.index === "noindex") out.noindex = true;
      return out;
    },

    async settings(target) {
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const r = await target.wpCli([
          "option",
          "get",
          "wpseo_titles",
          "--format=json",
        ]);
        if (r.exitCode === 0) {
          try {
            return JSON.parse(r.stdout || "{}");
          } catch {
            return {};
          }
        }
      }
      return {};
    },
  },
};
