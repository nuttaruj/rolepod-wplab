import type { Target } from "../../runtime/Target.js";

export interface ReplacePostMetaOpts {
  /** Filename prefix for backup + tmp files. Example: "elementor", "bricks-page". */
  backupPrefix: string;
  /**
   * Serialization mode for the payload written to the tmp file + decoded
   * inside `wp eval`.
   *   - "json": JSON.stringify value → file, json_decode(..., true) → PHP array
   *     stored as meta. Correct for builders whose meta is a serialized PHP
   *     array.
   *   - "json-string": JSON.stringify value → file, stored as a wp_slash'd JSON
   *     STRING (no decode). Correct for Elementor `_elementor_data`, which the
   *     editor reads as a JSON string — storing a decoded PHP array there makes
   *     Elementor fail to parse the page (renders empty).
   *   - "raw": value MUST be a string, written + stored verbatim.
   */
  serialization?: "json" | "raw" | "json-string";
}

export interface ReplacePostMetaResult {
  bytesWritten: number;
  backupPath: string | null;
}

function requireShellOrCompanion(target: Target, label: string): void {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker" &&
    !(target.kind === "rest" && target.companion?.enabled)
  ) {
    throw new Error(
      `${label} requires a shell-capable target OR a RestTarget with companion enabled.`,
    );
  }
}

/**
 * Replace a single post_meta value via wp-cli + scoped fileWrite.
 *
 * Why this helper exists: Round 6 surfaced 7 bugs in copy-pasted versions
 * of this same pattern across elementor / bricks / oxygen / rankmath /
 * divi / wpml / forms / yoast / rankmath adapters. Centralizing the
 * sequence eliminates drift:
 *
 *   1. Verify target supports shell (local/ssh/docker) OR is rest+companion.
 *   2. Read current value via `wp post meta get --format=json` for backup.
 *   3. If non-empty → write backup file under wp-content/uploads/wplab-backups/.
 *   4. Serialize the new value (JSON or raw string) → wp-content/uploads/wplab-tmp/.
 *   5. Replace via `wp eval update_post_meta(id, key, ...)` — `--from-file`
 *      is NOT a valid flag on `post meta update`, eval is the only path
 *      that handles arbitrary payload sizes without stdin pumping.
 *   6. Fall back to relative path if Target.fileWrite doesn't surface
 *      absolutePath (companion v2.7.2 and earlier omit it).
 */
export async function replacePostMeta(
  target: Target,
  postId: number,
  metaKey: string,
  value: unknown,
  opts: ReplacePostMetaOpts,
): Promise<ReplacePostMetaResult> {
  requireShellOrCompanion(target, `replacePostMeta(${metaKey})`);

  const serialization = opts.serialization ?? "json";
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
    const ext = serialization === "raw" ? "txt" : "json";
    const backupRel = `wp-content/uploads/wplab-backups/${opts.backupPrefix}-${postId}-${stamp}.${ext}`;
    const w = await target.fileWrite(backupRel, before.stdout, {
      backup: false,
    });
    backupPath = w.absolutePath || backupRel;
  }

  const payload =
    serialization === "raw"
      ? typeof value === "string"
        ? value
        : String(value)
      : JSON.stringify(value);

  const tmpExt = serialization === "raw" ? "txt" : "json";
  const tmpRel = `wp-content/uploads/wplab-tmp/${opts.backupPrefix}-${postId}-payload.${tmpExt}`;
  const tmpWrite = await target.fileWrite(tmpRel, payload, { backup: false });
  const filePath = tmpWrite.absolutePath || tmpRel;

  const decodeExpr =
    serialization === "json"
      ? `json_decode(file_get_contents(${JSON.stringify(filePath)}), true)`
      : serialization === "json-string"
        ? `wp_slash(file_get_contents(${JSON.stringify(filePath)}))`
        : `file_get_contents(${JSON.stringify(filePath)})`;

  const phpScript = `update_post_meta(${postId}, ${JSON.stringify(metaKey)}, ${decodeExpr});`;
  const result = await target.wpCli(["eval", phpScript], {
    allowDestructive: true,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `wp eval update_post_meta(${metaKey}) failed: ${result.stderr.slice(0, 200) || result.stdout.slice(0, 200)}`,
    );
  }

  return { bytesWritten: payload.length, backupPath };
}
