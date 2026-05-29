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
    // Elementor reads _elementor_data as a JSON STRING, not a PHP array — use
    // json-string so we store wp_slash'd JSON (storing a decoded array makes
    // Elementor render the page empty).
    return replacePostMeta(target, postId, "_elementor_data", widgetTree, {
      backupPrefix: "elementor",
      serialization: "json-string",
    });
  },
};
