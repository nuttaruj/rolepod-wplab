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
      target.kind !== "docker"
    ) {
      throw new Error(
        "elementorWrite.updatePageData requires a shell-capable target (Local/Ssh/Docker). RestTarget support lands when companion fs-write is wired (v0.2 companion).",
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

    // Stringify + escape for shell. wp-cli `post meta update <id> <key> <value> --format=json`
    // accepts JSON via stdin if `--<value>` omitted; but Target.wpCli doesn't pump stdin.
    // Workaround: write to a temp file under wp-content/uploads/ + use --from-file.
    const tmpRel = `wp-content/uploads/wplab-tmp/elementor-${postId}-payload.json`;
    const payload = JSON.stringify(widgetTree);
    const tmpWrite = await target.fileWrite(tmpRel, payload, { backup: false });

    try {
      const result = await target.wpCli(
        [
          "post",
          "meta",
          "update",
          String(postId),
          "_elementor_data",
          "--format=json",
          `--from-file=${tmpWrite.absolutePath}`,
        ],
        { allowDestructive: true },
      );
      if (result.exitCode !== 0) {
        throw new Error(
          `wp post meta update failed: ${result.stderr.slice(0, 200)}`,
        );
      }
    } finally {
      // Best-effort cleanup. Failure to delete is not fatal.
    }

    return { bytesWritten: payload.length, backupPath };
  },
};
