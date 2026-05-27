import type { Target } from "../../runtime/Target.js";
import type { Adapter } from "../_contract.ts";

export interface RankMathPostMeta {
  post_id: number;
  focus_keyword?: string;
  meta_description?: string;
  title?: string;
  canonical?: string;
}

export interface RankMathReadAPI {
  postMeta(target: Target, postId: number): Promise<RankMathPostMeta>;
  settings(target: Target): Promise<unknown>;
}

const SLUG = "rankmath";

export const rankmathAdapter: Adapter<RankMathReadAPI> = {
  slug: SLUG,
  name: "Rank Math SEO",
  supportedRange: { min: "1.0.200", testedUpTo: "1.0.220" },

  async detect(target: Target): Promise<boolean> {
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      try {
        const r = await target.wpCli([
          "plugin",
          "is-active",
          "seo-by-rank-math",
        ]);
        if (r.exitCode === 0) return true;
        const rPro = await target.wpCli([
          "plugin",
          "is-active",
          "seo-by-rank-math-pro",
        ]);
        return rPro.exitCode === 0;
      } catch {
        return false;
      }
    }
    // Rank Math doesn't expose a public /v1/ namespace under /rankmath/ by default.
    // For RestTarget, fall back to a heuristic: probe a known option via REST settings.
    try {
      const res = await target.rest({ method: "GET", path: "/wp/v2/settings" });
      const body = (res.body ?? {}) as Record<string, unknown>;
      return "rank_math_general" in body || "rank_math_titles" in body;
    } catch {
      return false;
    }
  },

  read: {
    async postMeta(target, postId) {
      // Rank Math meta keys live in postmeta under `rank_math_*`. REST API
      // doesn't expose them (no register_meta show_in_rest), so on RestTarget
      // we route via companion /db-query.
      if (target.kind === "rest" && target.companion?.enabled) {
        const { bridgeFor } = await import("../../companion/Bridge.js");
        const bridge = await bridgeFor(target);
        const result = await bridge.dbQuery(
          "SELECT meta_key, meta_value FROM {prefix}postmeta WHERE post_id = %d AND meta_key IN ('rank_math_focus_keyword', 'rank_math_description', 'rank_math_title', 'rank_math_canonical_url', 'rank_math_robots')",
          [postId],
        );
        const map: Record<string, string> = {};
        for (const row of result.rows) {
          map[String(row["meta_key"] ?? "")] = String(row["meta_value"] ?? "");
        }
        const out: RankMathPostMeta = { post_id: postId };
        if (map["rank_math_focus_keyword"]) out.focus_keyword = map["rank_math_focus_keyword"];
        if (map["rank_math_description"]) out.meta_description = map["rank_math_description"];
        if (map["rank_math_title"]) out.title = map["rank_math_title"];
        if (map["rank_math_canonical_url"]) out.canonical = map["rank_math_canonical_url"];
        return out;
      }
      if (
        target.kind === "local" ||
        target.kind === "ssh" ||
        target.kind === "docker"
      ) {
        const r = await target.wpCli([
          "post",
          "meta",
          "list",
          String(postId),
          "--format=json",
          "--keys=rank_math_focus_keyword,rank_math_description,rank_math_title,rank_math_canonical_url",
        ]);
        if (r.exitCode !== 0) return { post_id: postId };
        try {
          const rows = JSON.parse(r.stdout || "[]") as Array<{
            meta_key: string;
            meta_value: string;
          }>;
          const map: Record<string, string> = {};
          for (const row of rows) map[row.meta_key] = row.meta_value;
          const out: RankMathPostMeta = { post_id: postId };
          if (map["rank_math_focus_keyword"])
            out.focus_keyword = map["rank_math_focus_keyword"];
          if (map["rank_math_description"])
            out.meta_description = map["rank_math_description"];
          if (map["rank_math_title"]) out.title = map["rank_math_title"];
          if (map["rank_math_canonical_url"])
            out.canonical = map["rank_math_canonical_url"];
          return out;
        } catch {
          return { post_id: postId };
        }
      }
      return { post_id: postId };
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
          "rank-math-options-general",
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
