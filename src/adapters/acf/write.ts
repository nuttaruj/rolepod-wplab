import { recordChange } from "../../companion/ledger.js";
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

/**
 * Read the prior ACF value for the ledger — but only on a shell-capable target.
 * Forcing wp-cli on a RestTarget without a companion would raise
 * CompanionUnavailableError and turn a best-effort capture into a hard failure.
 */
async function captureBefore(
  target: Target,
  postId: number,
  fieldName: string,
): Promise<unknown> {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker"
  ) {
    return null;
  }
  try {
    const r = await target.wpCli([
      "post",
      "meta",
      "get",
      String(postId),
      fieldName,
      "--format=json",
    ]);
    if (r.exitCode !== 0 || r.stdout.trim().length === 0) return null;
    return JSON.parse(r.stdout) as unknown;
  } catch {
    return null;
  }
}

/**
 * ACF values are always recorded reversible:false. An ACF field can be a
 * repeater or group, and restoring one with raw `update_post_meta` corrupts
 * it — a revert has to go back through ACF. The prior value is captured for
 * reference, not for an automated undo.
 */
async function recordAcf(
  target: Target,
  postId: number,
  fieldName: string,
  before: unknown,
  value: unknown,
): Promise<void> {
  await recordChange(target, {
    category: "post",
    subcategory: `acf:${fieldName}`,
    targetDescriptor: `ACF field ${fieldName} on post ${postId}`,
    beforeState: { value: before },
    afterState: { value },
    reversible: false,
    notes:
      "ACF values must be restored through ACF, not raw post meta — reverting a repeater/group field with update_post_meta corrupts it. The prior value above is for reference; re-apply it with a fresh acf_write if needed.",
    sourceTool: "rolepod_wp_acf_write",
  });
}

export const acfWrite: AcfWriteAPI = {
  async setPostMeta(target, postId, fieldName, value) {
    const before = await captureBefore(target, postId, fieldName);

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
        await recordAcf(target, postId, fieldName, before, value);
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
      await recordAcf(target, postId, fieldName, before, value);
      return { source: "wp_cli" };
    }

    throw new Error(
      "acf.setPostMeta on RestTarget without ACF Pro REST requires companion v0.2 (fs/exec endpoints).",
    );
  },
};
