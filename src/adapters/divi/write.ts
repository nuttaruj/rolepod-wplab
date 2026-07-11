import { recordChange } from "../../companion/ledger.js";
import type { Target } from "../../runtime/Target.js";

export interface DiviWriteAPI {
  /**
   * Replace post_content with a new Divi shortcode string (full builder layout).
   * Backs up the prior content under wp-content/uploads/wplab-backups/ before overwrite.
   */
  updatePageContent(
    target: Target,
    postId: number,
    content: string,
    opts?: { ensureBuilderFlag?: boolean },
  ): Promise<{ bytesWritten: number; backupPath: string | null }>;
}

export const diviWrite: DiviWriteAPI = {
  async updatePageContent(target, postId, content, opts = {}) {
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker" &&
      !(target.kind === "rest" && target.companion?.enabled)
    ) {
      throw new Error(
        "diviWrite.updatePageContent requires a shell-capable target. RestTarget needs companion fs/exec.",
      );
    }

    const before = await target.wpCli([
      "post",
      "get",
      String(postId),
      "--field=post_content",
    ]);
    const beforeContent = before.exitCode === 0 ? before.stdout : null;
    let backupPath: string | null = null;
    if (before.exitCode === 0 && before.stdout.length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const relPath = `wp-content/uploads/wplab-backups/divi-${postId}-${stamp}.html`;
      const w = await target.fileWrite(relPath, before.stdout, {
        backup: false,
      });
      backupPath = w.absolutePath;
    }

    const tmpRel = `wp-content/uploads/wplab-tmp/divi-${postId}-content.html`;
    const tmpWrite = await target.fileWrite(tmpRel, content, { backup: false });

    const result = await target.wpCli(
      ["post", "update", String(postId), tmpWrite.absolutePath],
      { allowDestructive: true },
    );
    if (result.exitCode !== 0) {
      throw new Error(`wp post update failed: ${result.stderr.slice(0, 200)}`);
    }

    if (opts.ensureBuilderFlag) {
      const setMeta = await target.wpCli(
        ["post", "meta", "update", String(postId), "_et_pb_use_builder", "on"],
        { allowDestructive: true },
      );
      if (setMeta.exitCode !== 0) {
        throw new Error(
          `wp post meta update _et_pb_use_builder failed: ${setMeta.stderr.slice(0, 200)}`,
        );
      }
    }

    // Divi writes the layout into post_content, so it bypasses the
    // replacePostMeta chokepoint where every other builder gets its ledger row.
    // Record here instead. Reversible only when we captured the prior content —
    // the companion's `post` dispatcher restores post_content from beforeState.
    if (beforeContent !== null) {
      await recordChange(target, {
        category: "post",
        subcategory: "post_content",
        targetDescriptor: `divi layout → post ${postId} content`,
        beforeState: { post_content: beforeContent },
        afterState: { post_content: content },
        reversible: true,
        sourceTool: "rolepod_wp_divi_write",
      });
    }

    return { bytesWritten: content.length, backupPath };
  },
};
