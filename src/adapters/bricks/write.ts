import type { Target } from "../../runtime/Target.js";

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

async function replaceMeta(
  target: Target,
  postId: number,
  metaKey: string,
  elements: unknown[],
  backupFilePrefix: string,
): Promise<{ bytesWritten: number; backupPath: string | null }> {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker" &&
    !(target.kind === "rest" && target.companion?.enabled)
  ) {
    throw new Error(
      "bricksWrite requires a shell-capable target OR a RestTarget with companion enabled.",
    );
  }
  const before = await target.wpCli([
    "post",
    "meta",
    "get",
    String(postId),
    metaKey,
    "--format=json",
  ]);
  let backupPath: string | null = null;
  if (before.exitCode === 0 && before.stdout.trim().length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const relPath = `wp-content/uploads/wplab-backups/${backupFilePrefix}-${postId}-${stamp}.json`;
    const w = await target.fileWrite(relPath, before.stdout, { backup: false });
    backupPath = w.absolutePath;
  }

  const tmpRel = `wp-content/uploads/wplab-tmp/${backupFilePrefix}-${postId}-payload.json`;
  const payload = JSON.stringify(elements);
  const tmpWrite = await target.fileWrite(tmpRel, payload, { backup: false });

  const phpScript = `update_post_meta(${postId}, ${JSON.stringify(metaKey)}, json_decode(file_get_contents(${JSON.stringify(tmpWrite.absolutePath)}), true));`;
  const r = await target.wpCli(["eval", phpScript], {
    allowDestructive: true,
  });
  if (r.exitCode !== 0) {
    throw new Error(
      `wp eval update_post_meta(${metaKey}) failed: ${r.stderr.slice(0, 200) || r.stdout.slice(0, 200)}`,
    );
  }
  return { bytesWritten: payload.length, backupPath };
}

export const bricksWrite: BricksWriteAPI = {
  updatePageContent: (t, id, els) =>
    replaceMeta(t, id, "_bricks_page_content_2", els, "bricks-page"),
  updateHeaderContent: (t, id, els) =>
    replaceMeta(t, id, "_bricks_header_content", els, "bricks-header"),
  updateFooterContent: (t, id, els) =>
    replaceMeta(t, id, "_bricks_footer_content", els, "bricks-footer"),
};
