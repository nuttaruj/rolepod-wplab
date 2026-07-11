import { replacePostMeta } from "../_shared/replacePostMeta.js";
import { writeScalarMeta } from "../_shared/writeScalarMeta.js";
import type { Target } from "../../runtime/Target.js";

export interface RankMathWriteFields {
  focus_keyword?: string;
  meta_description?: string;
  title?: string;
  canonical?: string;
  noindex?: boolean;
}

export interface RankMathWriteAPI {
  setPostMeta(
    target: Target,
    postId: number,
    fields: RankMathWriteFields,
  ): Promise<{ updated: string[]; source: "wp_cli" }>;
}

const KEY_MAP: Record<Exclude<keyof RankMathWriteFields, "noindex">, string> = {
  focus_keyword: "rank_math_focus_keyword",
  meta_description: "rank_math_description",
  title: "rank_math_title",
  canonical: "rank_math_canonical_url",
};

export const rankmathWrite: RankMathWriteAPI = {
  async setPostMeta(target, postId, fields) {
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker" &&
      !(target.kind === "rest" && target.companion?.enabled)
    ) {
      throw new Error(
        "rankmathWrite.setPostMeta requires shell-capable target OR a RestTarget with companion enabled.",
      );
    }
    const updated: string[] = [];
    for (const [field, value] of Object.entries(fields) as Array<
      [keyof RankMathWriteFields, string | boolean | undefined]
    >) {
      if (value === undefined) continue;
      if (field === "noindex") {
        const robots: string[] = value ? ["noindex"] : [];
        await replacePostMeta(target, postId, "rank_math_robots", robots, {
          backupPrefix: "rankmath-robots",
          serialization: "json",
          sourceTool: "rolepod_wp_rankmath_write",
          category: "post",
        });
        updated.push(field);
        continue;
      }
      const metaKey = KEY_MAP[field];
      await writeScalarMeta(
        target,
        postId,
        metaKey,
        String(value),
        "rolepod_wp_rankmath_write",
      );
      updated.push(field);
    }
    return { updated, source: "wp_cli" };
  },
};
