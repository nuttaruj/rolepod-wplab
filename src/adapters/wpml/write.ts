import type { Target } from "../../runtime/Target.js";

export type WpmlWriteOp =
  | { op: "set_post_language"; post_id: number; language_code: string }
  | {
      op: "link_translations";
      original_post_id: number;
      translations: Record<string, number>;
    }
  | {
      op: "duplicate_for_translation";
      post_id: number;
      target_language: string;
    };

export interface WpmlWriteAPI {
  /**
   * Set the language of a post (`wp wpml post update <id> --language=<code>`
   * if WPML CLI installed; otherwise REST /wpml/v1/posts/{id}/language).
   */
  setPostLanguage(
    target: Target,
    postId: number,
    languageCode: string,
  ): Promise<{ source: "wp_cli" | "rest" }>;

  /**
   * Link a group of translations (one post per language) to a single
   * translation group via WPML REST /wpml/v1/posts/{id}/translations.
   */
  linkTranslations(
    target: Target,
    originalPostId: number,
    translations: Record<string, number>,
  ): Promise<{ source: "rest"; linked_count: number }>;

  /**
   * Duplicate a post for translation (`wp wpml post duplicate <id> --target-lang=<code>`).
   */
  duplicateForTranslation(
    target: Target,
    postId: number,
    targetLanguage: string,
  ): Promise<{ source: "wp_cli"; new_post_id: number }>;
}

export const wpmlWrite: WpmlWriteAPI = {
  async setPostLanguage(target, postId, languageCode) {
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      const r = await target.wpCli(
        [
          "wpml",
          "post",
          "update",
          String(postId),
          `--language=${languageCode}`,
        ],
        { allowDestructive: true },
      );
      if (r.exitCode === 0) return { source: "wp_cli" };
    }
    const res = await target.rest({
      method: "POST",
      path: `/wpml/v1/posts/${postId}/language`,
      body: { language_code: languageCode },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`wpml setPostLanguage REST returned HTTP ${res.status}`);
    }
    return { source: "rest" };
  },

  async linkTranslations(target, originalPostId, translations) {
    const res = await target.rest({
      method: "POST",
      path: `/wpml/v1/posts/${originalPostId}/translations`,
      body: { translations },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`wpml linkTranslations REST returned HTTP ${res.status}`);
    }
    return { source: "rest", linked_count: Object.keys(translations).length };
  },

  async duplicateForTranslation(target, postId, targetLanguage) {
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker"
    ) {
      throw new Error(
        "wpml duplicateForTranslation requires shell-capable target (uses WPML CLI).",
      );
    }
    const r = await target.wpCli(
      [
        "wpml",
        "post",
        "duplicate",
        String(postId),
        `--target-lang=${targetLanguage}`,
        "--porcelain",
      ],
      { allowDestructive: true },
    );
    if (r.exitCode !== 0) {
      throw new Error(`wpml duplicate failed: ${r.stderr.slice(0, 200)}`);
    }
    const newId = Number.parseInt(r.stdout.trim(), 10);
    if (!Number.isFinite(newId) || newId <= 0) {
      throw new Error(
        `wpml duplicate returned non-integer post id: "${r.stdout.trim()}"`,
      );
    }
    return { source: "wp_cli", new_post_id: newId };
  },
};
