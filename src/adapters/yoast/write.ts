import type { Target } from "../../runtime/Target.js";

export interface YoastWriteFields {
  focus_keyword?: string;
  meta_description?: string;
  title?: string;
  canonical?: string;
  noindex?: boolean;
}

export interface YoastWriteAPI {
  /**
   * Update Yoast SEO post meta keys.
   *   _yoast_wpseo_focuskw, _yoast_wpseo_metadesc, _yoast_wpseo_title,
   *   _yoast_wpseo_canonical, _yoast_wpseo_meta-robots-noindex (1/0).
   */
  setPostMeta(
    target: Target,
    postId: number,
    fields: YoastWriteFields,
  ): Promise<{ updated: string[]; source: "wp_cli" }>;
}

const KEY_MAP: Record<keyof YoastWriteFields, string> = {
  focus_keyword: "_yoast_wpseo_focuskw",
  meta_description: "_yoast_wpseo_metadesc",
  title: "_yoast_wpseo_title",
  canonical: "_yoast_wpseo_canonical",
  noindex: "_yoast_wpseo_meta-robots-noindex",
};

export const yoastWrite: YoastWriteAPI = {
  async setPostMeta(target, postId, fields) {
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker"
    ) {
      throw new Error(
        "yoastWrite.setPostMeta requires a shell-capable target. RestTarget needs companion v0.2 fs/exec.",
      );
    }
    const updated: string[] = [];
    for (const [field, value] of Object.entries(fields) as Array<
      [keyof YoastWriteFields, string | boolean | undefined]
    >) {
      if (value === undefined) continue;
      const metaKey = KEY_MAP[field];
      const metaValue =
        field === "noindex" ? (value ? "1" : "0") : String(value);
      const r = await target.wpCli(
        ["post", "meta", "update", String(postId), metaKey, metaValue],
        { allowDestructive: true },
      );
      if (r.exitCode !== 0) {
        throw new Error(
          `yoast.setPostMeta ${metaKey} failed: ${r.stderr.slice(0, 200)}`,
        );
      }
      updated.push(field);
    }
    return { updated, source: "wp_cli" };
  },
};
