import type { Target } from "../../runtime/Target.js";
import { writeElementorData } from "../../lib/elementorData.js";

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
    // writeElementorData handles the json-string serialization (a decoded PHP
    // array makes Elementor render empty) AND flushes the Elementor CSS cache
    // afterwards — a direct meta write leaves the cached per-post CSS stale, so
    // without the flush the front-end keeps rendering the OLD layout.
    return writeElementorData(target, postId, widgetTree);
  },
};
