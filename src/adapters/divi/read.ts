import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface DiviPageSummary {
  id: number;
  title: string;
  status: string;
  uses_divi_builder: boolean;
}

export interface DiviPageDetail {
  id: number;
  title: string;
  uses_divi_builder: boolean;
  content: string;
  meta: {
    et_pb_use_builder?: string;
    et_pb_post_settings?: string;
  };
  bytes: number;
}

export interface DiviReadAPI {
  /** List pages flagged with `_et_pb_use_builder = on`. */
  listPages(
    target: Target,
    opts?: { type?: string; per_page?: number },
  ): Promise<DiviPageSummary[]>;

  /** Dump full Divi shortcode content + builder flag meta for one post. */
  getPage(target: Target, postId: number): Promise<DiviPageDetail>;
}

const SLUG = "divi";

export const diviAdapter: Adapter<DiviReadAPI> = {
  slug: SLUG,
  name: "Divi Builder",
  supportedRange: { min: "4.20", testedUpTo: "4.27" },

  async detect(target: Target): Promise<boolean> {
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli(["theme", "is-active", "Divi"]);
        if (r.exitCode === 0) return true;
        const child = await target.wpCli(["theme", "is-active", "Divi-child"]);
        if (child.exitCode === 0) return true;
        const pluginR = await target.wpCli([
          "plugin",
          "is-active",
          "divi-builder",
        ]);
        return pluginR.exitCode === 0;
      } catch {
        return false;
      }
    }
    try {
      const res = await target.rest({
        method: "GET",
        path: "/wp/v2/themes",
        query: { status: "active" },
      });
      const items = Array.isArray(res.body) ? res.body : [];
      for (const raw of items) {
        const t = raw as { stylesheet?: string; template?: string };
        if (t.stylesheet === "Divi" || t.template === "Divi") return true;
        if (t.stylesheet === "Divi-child") return true;
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
      const out: DiviPageSummary[] = [];
      for (const raw of items) {
        const p = raw as {
          id: number;
          title: { rendered: string };
          status: string;
          meta?: Record<string, unknown>;
        };
        const usesDivi = p.meta?.["_et_pb_use_builder"] === "on";
        out.push({
          id: p.id,
          title: p.title.rendered,
          status: p.status,
          uses_divi_builder: usesDivi,
        });
      }
      return out;
    },

    async getPage(target, postId) {
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const content = await target.wpCli([
          "post",
          "get",
          String(postId),
          "--field=post_content",
        ]);
        const title = await target.wpCli([
          "post",
          "get",
          String(postId),
          "--field=post_title",
        ]);
        const useBuilder = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "_et_pb_use_builder",
        ]);
        const postSettings = await target.wpCli([
          "post",
          "meta",
          "get",
          String(postId),
          "_et_pb_post_settings",
        ]);
        const body = content.exitCode === 0 ? content.stdout : "";
        const meta: DiviPageDetail["meta"] = {};
        if (useBuilder.exitCode === 0 && useBuilder.stdout.trim()) {
          meta.et_pb_use_builder = useBuilder.stdout.trim();
        }
        if (postSettings.exitCode === 0 && postSettings.stdout.trim()) {
          meta.et_pb_post_settings = postSettings.stdout.trim();
        }
        return {
          id: postId,
          title: title.exitCode === 0 ? title.stdout.trim() : "",
          uses_divi_builder: meta.et_pb_use_builder === "on",
          content: body,
          meta,
          bytes: body.length,
        };
      }
      throw new Error(
        "divi.getPage on RestTarget requires companion v0.2 (post_content + meta access).",
      );
    },
  },
};
