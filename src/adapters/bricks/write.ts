import { replacePostMeta } from "../_shared/replacePostMeta.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";

export type BricksScope = "page" | "header" | "footer";

/**
 * Bricks stores the element tree for a page AND for a header/footer template in
 * the same meta key, `_bricks_page_content_2`. A header template is a separate
 * post of type `bricks_template`; the tree lives on that post, not on the page
 * the header renders above.
 *
 * The previous adapter wrote header/footer trees to `_bricks_header_content` /
 * `_bricks_footer_content`, which Bricks never reads — the write was a no-op.
 * Pointing them at `_bricks_page_content_2` fixes that, but it introduces a
 * data-loss trap: writing a header tree to `_bricks_page_content_2` on a normal
 * page overwrites that page's body. `assertTemplatePost()` closes the trap.
 */
export interface BricksWriteAPI {
  updatePageContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
  updateHeaderContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
  updateFooterContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
}

const META_KEY = "_bricks_page_content_2";

export const bricksWrite: BricksWriteAPI = {
  updatePageContent: (t, id, els) =>
    replacePostMeta(t, id, META_KEY, els, {
      backupPrefix: "bricks-page",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
  updateHeaderContent: (t, id, els) =>
    replacePostMeta(t, id, META_KEY, els, {
      backupPrefix: "bricks-header",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
  updateFooterContent: (t, id, els) =>
    replacePostMeta(t, id, META_KEY, els, {
      backupPrefix: "bricks-footer",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
};

export class BricksWrongPostTypeError extends WplabError {
  constructor(scope: BricksScope, postId: number, postType: string) {
    super(
      "BRICKS_WRONG_POST_TYPE",
      `Refusing a ${scope} write to post ${postId}: it is a "${postType}", not a "bricks_template". ` +
        `Bricks stores a ${scope} tree in ${META_KEY}, the same key a page uses for its body — ` +
        `writing here would overwrite the page's content. Point ${scope} writes at the ${scope} template post (a bricks_template).`,
      { scope, postId, postType },
    );
  }
}

/**
 * Guard for header/footer scopes: the target post must be a bricks_template,
 * or the write would clobber a page body via the shared meta key.
 *
 * Fails closed. A post type we cannot read, or one that is not bricks_template,
 * is refused — blocking a legitimate template write is an inconvenience;
 * allowing a write onto a page is data loss.
 */
export async function assertTemplatePost(
  target: Target,
  postId: number,
  scope: BricksScope,
): Promise<void> {
  if (scope === "page") return;

  const r = await target.wpCli([
    "post",
    "get",
    String(postId),
    "--field=post_type",
  ]);
  const postType = r.exitCode === 0 ? r.stdout.trim() : "";
  if (postType !== "bricks_template") {
    throw new BricksWrongPostTypeError(scope, postId, postType || "unknown");
  }
}
