import type { Target } from "../../runtime/Target.js";
import { replacePostMeta } from "../_shared/replacePostMeta.js";

export interface BricksWriteAPI {
  /** Replace `_bricks_page_content_2` post meta (Bricks element tree JSON). */
  updatePageContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;

  /** Replace header template content (`_bricks_header_content`). */
  updateHeaderContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;

  /** Replace footer template content (`_bricks_footer_content`). */
  updateFooterContent(
    target: Target,
    postId: number,
    elements: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
}

export const bricksWrite: BricksWriteAPI = {
  updatePageContent: (t, id, els) =>
    replacePostMeta(t, id, "_bricks_page_content_2", els, {
      backupPrefix: "bricks-page",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
  updateHeaderContent: (t, id, els) =>
    replacePostMeta(t, id, "_bricks_header_content", els, {
      backupPrefix: "bricks-header",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
  updateFooterContent: (t, id, els) =>
    replacePostMeta(t, id, "_bricks_footer_content", els, {
      backupPrefix: "bricks-footer",
      serialization: "json",
      sourceTool: "rolepod_wp_bricks_write",
    }),
};
