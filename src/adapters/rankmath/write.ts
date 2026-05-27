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
        const robots = value ? '["noindex"]' : "[]";
        const tmpRel = `wp-content/uploads/wplab-tmp/rankmath-${postId}-robots.json`;
        const tmp = await target.fileWrite(tmpRel, robots, { backup: false });
        const filePath = tmp.absolutePath || tmpRel;
        const phpScript = `update_post_meta(${postId}, "rank_math_robots", json_decode(file_get_contents(${JSON.stringify(filePath)}), true));`;
        const r = await target.wpCli(["eval", phpScript], {
          allowDestructive: true,
        });
        if (r.exitCode !== 0) {
          throw new Error(
            `rankmath rank_math_robots failed: ${r.stderr.slice(0, 200) || r.stdout.slice(0, 200)}`,
          );
        }
        updated.push(field);
        continue;
      }
      const metaKey = KEY_MAP[field];
      const r = await target.wpCli(
        ["post", "meta", "update", String(postId), metaKey, String(value)],
        { allowDestructive: true },
      );
      if (r.exitCode !== 0) {
        throw new Error(
          `rankmath ${metaKey} failed: ${r.stderr.slice(0, 200)}`,
        );
      }
      updated.push(field);
    }
    return { updated, source: "wp_cli" };
  },
};
