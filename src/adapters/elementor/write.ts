import type { Target } from "../../runtime/Target.js";

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
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker" &&
      !(target.kind === "rest" && target.companion?.enabled)
    ) {
      throw new Error(
        "elementorWrite.updatePageData requires a shell-capable target OR a RestTarget with companion enabled.",
      );
    }

    // Backup current value first.
    const before = await target.wpCli([
      "post",
      "meta",
      "get",
      String(postId),
      "_elementor_data",
      "--format=json",
    ]);
    let backupPath: string | null = null;
    if (before.exitCode === 0 && before.stdout.trim().length > 0) {
      // Use scoped fileWrite to drop a backup under wp-content/uploads/
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const relPath = `wp-content/uploads/wplab-backups/elementor-${postId}-${stamp}.json`;
      const w = await target.fileWrite(relPath, before.stdout, {
        backup: false,
      });
      backupPath = w.absolutePath;
    }

    // wp-cli `post meta update` does NOT support --from-file. Route via `wp eval`
    // reading the temp file + json_decode + update_post_meta.
    const tmpRel = `wp-content/uploads/wplab-tmp/elementor-${postId}-payload.json`;
    const payload = JSON.stringify(widgetTree);
    const tmpWrite = await target.fileWrite(tmpRel, payload, { backup: false });
    // wp-cli runs from ABSPATH — relative path resolves correctly. Fall back to
    // absolutePath when present (some Target impls supply it).
    const filePath = tmpWrite.absolutePath || tmpRel;

    const phpScript = `update_post_meta(${postId}, "_elementor_data", json_decode(file_get_contents(${JSON.stringify(filePath)}), true));`;
    const result = await target.wpCli(["eval", phpScript], {
      allowDestructive: true,
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `wp eval update_post_meta(_elementor_data) failed: ${result.stderr.slice(0, 200) || result.stdout.slice(0, 200)}`,
      );
    }

    return { bytesWritten: payload.length, backupPath };
  },
};
