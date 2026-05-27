import type { Target } from "../../runtime/Target.js";
import { replacePostMeta } from "../_shared/replacePostMeta.js";

export interface ElementorWriteAPI {
  /** Replace the full _elementor_data widget tree on a post. */
  updatePageData(
    target: Target,
    postId: number,
    widgetTree: unknown[],
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
}

export const elementorWrite: ElementorWriteAPI = {
  async updatePageData(target, postId, widgetTree) {
    return replacePostMeta(target, postId, "_elementor_data", widgetTree, {
      backupPrefix: "elementor",
      serialization: "json",
    });
  },
};
