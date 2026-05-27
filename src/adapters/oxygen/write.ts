import type { Target } from "../../runtime/Target.js";
import { replacePostMeta } from "../_shared/replacePostMeta.js";

export interface OxygenWriteAPI {
  /**
   * Replace `ct_builder_shortcodes` post meta with new Oxygen shortcode payload.
   * Backs up prior value to wp-content/uploads/wplab-backups/.
   */
  updatePageShortcodes(
    target: Target,
    postId: number,
    shortcodes: string,
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
}

export const oxygenWrite: OxygenWriteAPI = {
  updatePageShortcodes: (target, postId, shortcodes) =>
    replacePostMeta(target, postId, "ct_builder_shortcodes", shortcodes, {
      backupPrefix: "oxygen",
      serialization: "raw",
    }),
};
