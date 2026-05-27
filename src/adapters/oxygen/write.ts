import type { Target } from "../../runtime/Target.js";

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
  async updatePageShortcodes(target, postId, shortcodes) {
    if (
      target.kind !== "local" &&
      target.kind !== "ssh" &&
      target.kind !== "docker" &&
      !(target.kind === "rest" && target.companion?.enabled)
    ) {
      throw new Error(
        "oxygenWrite.updatePageShortcodes requires a shell-capable target.",
      );
    }

    const before = await target.wpCli([
      "post",
      "meta",
      "get",
      String(postId),
      "ct_builder_shortcodes",
    ]);
    let backupPath: string | null = null;
    if (before.exitCode === 0 && before.stdout.length > 0) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const relPath = `wp-content/uploads/wplab-backups/oxygen-${postId}-${stamp}.txt`;
      const w = await target.fileWrite(relPath, before.stdout, {
        backup: false,
      });
      backupPath = w.absolutePath;
    }

    const tmpRel = `wp-content/uploads/wplab-tmp/oxygen-${postId}-shortcodes.txt`;
    const tmpWrite = await target.fileWrite(tmpRel, shortcodes, {
      backup: false,
    });

    const result = await target.wpCli(
      [
        "post",
        "meta",
        "update",
        String(postId),
        "ct_builder_shortcodes",
        `--from-file=${tmpWrite.absolutePath}`,
      ],
      { allowDestructive: true },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `wp post meta update ct_builder_shortcodes failed: ${result.stderr.slice(0, 200)}`,
      );
    }

    return { bytesWritten: shortcodes.length, backupPath };
  },
};
