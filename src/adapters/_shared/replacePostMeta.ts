import { recordChange } from "../../companion/ledger.js";
import type { ChangeRecord } from "../../companion/ledger.js";
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
  /** MCP tool name, recorded in the change ledger. */
  sourceTool: string;
  /** Ledger category. Builder trees are `layout`; plugin meta is `post`. */
  category?: ChangeRecord["category"];
}

export interface ReplacePostMetaResult {
  bytesWritten: number;
  backupPath: string | null;
  /** The written value was read back and matched. Always true — we throw otherwise. */
  verified: true;
  /** Ledger row id, or null when the target has no companion. */
  auditId: string | null;
}

export class PostMetaVerifyError extends Error {
  readonly code = "POST_META_VERIFY_FAILED";
  constructor(
    readonly metaKey: string,
    readonly postId: number,
    readonly backupPath: string | null,
    detail: string,
  ) {
    super(
      `Wrote ${metaKey} on post ${postId}, but reading it back did not return what was written: ${detail}. ` +
        (backupPath
          ? `The previous value is at ${backupPath}.`
          : `No backup was taken — the meta key had no previous value.`) +
        ` The post is in an unverified state; do not write to it again until you have read it.`,
    );
    this.name = "PostMetaVerifyError";
  }
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
 *   3. If non-empty → write backup file under wp-content/uploads/rolepod-wp/backups/.
 *   4. Serialize the new value (JSON or raw string) → wp-content/uploads/rolepod-wp/tmp/.
 *   5. Replace via `wp eval update_post_meta(id, key, ...)` — `--from-file`
 *      is NOT a valid flag on `post meta update`, eval is the only path
 *      that handles arbitrary payload sizes without stdin pumping.
 *   6. Read the value back and compare it to what was written. `wp eval`
 *      exits 0 even when `update_post_meta` returns false, so a zero exit
 *      code is not evidence the write landed.
 *   7. Record the change in the ledger so it can be reverted.
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
  const before = await readMeta(target, postId, metaKey);

  let backupPath: string | null = null;
  if (before !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ext = serialization === "raw" ? "txt" : "json";
    const backupRel = `wp-content/uploads/rolepod-wp/backups/${opts.backupPrefix}-${postId}-${stamp}.${ext}`;
    const w = await target.fileWrite(backupRel, before, { backup: false });
    backupPath = w.absolutePath || backupRel;
  }

  const payload =
    serialization === "raw"
      ? typeof value === "string"
        ? value
        : String(value)
      : JSON.stringify(value);

  const tmpExt = serialization === "raw" ? "txt" : "json";
  const tmpRel = `wp-content/uploads/rolepod-wp/tmp/${opts.backupPrefix}-${postId}-payload.${tmpExt}`;
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

  const after = await readMeta(target, postId, metaKey);
  assertRoundTrip(after, value, payload, serialization, {
    metaKey,
    postId,
    backupPath,
  });

  const reversible = isReversible(serialization);
  const audit = await recordChange(target, {
    category: opts.category ?? "layout",
    subcategory: metaKey,
    targetDescriptor: `post:${postId}:${metaKey}`,
    beforeState: before,
    afterState: payload,
    reversible,
    sourceTool: opts.sourceTool,
    ...(reversible
      ? {}
      : {
          notes: `Not revertible through the ledger: ${metaKey} is stored as a JSON string, and the companion's layout dispatcher restores post meta as an array. ${
            backupPath
              ? `Restore by hand from ${backupPath}.`
              : `No backup exists — the key had no previous value.`
          }`,
        }),
  });

  return {
    bytesWritten: payload.length,
    backupPath,
    verified: true,
    auditId: audit?.auditId ?? null,
  };
}

/**
 * `json` and `raw` both round-trip cleanly: an array comes back an array, a
 * shortcode string comes back the same string, and the companion's `layout`
 * dispatcher can write either one back.
 *
 * `json-string` (Elementor `_elementor_data`) cannot: restoring it as an array
 * is exactly the double-encoding bug the serialization mode exists to avoid.
 */
function isReversible(serialization: "json" | "raw" | "json-string"): boolean {
  return serialization !== "json-string";
}

/** Raw `wp post meta get --format=json` stdout, or null when unset/empty. */
async function readMeta(
  target: Target,
  postId: number,
  metaKey: string,
): Promise<string | null> {
  const r = await target.wpCli([
    "post",
    "meta",
    "get",
    String(postId),
    metaKey,
    "--format=json",
  ]);
  if (r.exitCode !== 0) return null;
  const out = r.stdout.trim();
  return out.length > 0 ? out : null;
}

function assertRoundTrip(
  after: string | null,
  value: unknown,
  payload: string,
  serialization: "json" | "raw" | "json-string",
  ctx: { metaKey: string; postId: number; backupPath: string | null },
): void {
  const fail = (detail: string): never => {
    throw new PostMetaVerifyError(
      ctx.metaKey,
      ctx.postId,
      ctx.backupPath,
      detail,
    );
  };

  if (after === null) return fail("the meta key is empty after the write");

  let decoded: unknown;
  try {
    decoded = JSON.parse(after);
  } catch {
    return fail("the value read back is not valid JSON");
  }

  // `json` stores a PHP array; `json-string` and `raw` store a string. In both
  // cases `--format=json` gives us the stored value, JSON-encoded once.
  const expected: unknown = serialization === "json" ? value : payload;
  const equal =
    serialization === "json"
      ? deepEqualThroughPhp(decoded, expected)
      : deepEqual(decoded, expected);
  if (!equal) {
    fail(
      `expected ${preview(expected)} but the site returned ${preview(decoded)}`,
    );
  }
}

/**
 * Like deepEqual, but tolerant of the one transform a PHP round-trip always
 * applies: `json_decode($s, true)` turns `{}` into an empty PHP array, which
 * `json_encode` then emits as `[]`. A widget with `settings: {}` therefore
 * comes back as `settings: []` however faithfully the site stored it.
 *
 * Only used for `serialization: "json"`. Nothing else about the shape may
 * differ.
 */
function deepEqualThroughPhp(a: unknown, b: unknown): boolean {
  if (isEmptyContainer(a) && isEmptyContainer(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, i) => deepEqualThroughPhp(item, b[i]))
    );
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const ak = Object.keys(a);
    if (ak.length !== Object.keys(b).length) return false;
    return ak.every(
      (k) => Object.hasOwn(b, k) && deepEqualThroughPhp(a[k], b[k]),
    );
  }
  return a === b;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isEmptyContainer(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  return isPlainObject(v) && Object.keys(v).length === 0;
}

function preview(v: unknown): string {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

/** Structural equality. Object key order is irrelevant; array order is not. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}

export const _exposed_for_tests = {
  deepEqual,
  deepEqualThroughPhp,
  isReversible,
};
