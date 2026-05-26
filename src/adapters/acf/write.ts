import type { Target } from "../../runtime/Target.js";

export interface AcfWriteAPI {
  /**
   * Set a typed ACF post meta value. Routes:
   *   - ACF Pro REST: POST /wp/v2/posts/{id} with { acf: { field: value } }
   *   - shell-capable: wp-cli `post meta update <id> <field> <value> --format=json`
   *
   * Free ACF without Pro REST falls through to wp-cli; if neither available
   * (RestTarget without companion v0.2 fs/exec endpoints), throws.
   */
  setPostMeta(
    target: Target,
    postId: number,
    fieldName: string,
    value: unknown,
  ): Promise<{ source: "rest_acf_pro" | "wp_cli" }>;
}

export const acfWrite: AcfWriteAPI = {
  async setPostMeta(target, postId, fieldName, value) {
    // Try ACF Pro REST first (works on RestTarget without companion)
    const restRes = await target.rest({
      method: "POST",
      path: `/wp/v2/posts/${postId}`,
      body: { acf: { [fieldName]: value } },
    });
    if (restRes.status >= 200 && restRes.status < 300) {
      const body = (restRes.body ?? {}) as { acf?: Record<string, unknown> };
      // Confirm the field actually applied (Pro returns the updated value)
      if (body.acf && fieldName in body.acf) {
        return { source: "rest_acf_pro" };
      }
    }

    // Fall back to wp-cli
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      const stringified =
        typeof value === "string" ? value : JSON.stringify(value);
      const r = await target.wpCli(
        [
          "post",
          "meta",
          "update",
          String(postId),
          fieldName,
          stringified,
          "--format=json",
        ],
        { allowDestructive: true },
      );
      if (r.exitCode !== 0) {
        throw new Error(
          `acf.setPostMeta wp-cli fallback failed: ${r.stderr.slice(0, 200)}`,
        );
      }
      return { source: "wp_cli" };
    }

    throw new Error(
      "acf.setPostMeta on RestTarget without ACF Pro REST requires companion v0.2 (fs/exec endpoints).",
    );
  },
};
