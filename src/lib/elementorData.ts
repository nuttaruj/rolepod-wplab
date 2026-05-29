import type { Target } from "../runtime/Target.js";
import { replacePostMeta } from "../adapters/_shared/replacePostMeta.js";
import { flushElementorCss } from "../companion/cacheFlush.js";
import { WplabError } from "../util/errors.js";

/**
 * Shared `_elementor_data` read/decode/write helpers.
 *
 * Centralizes the three things that bit us repeatedly while editing live
 * Elementor pages by hand:
 *   1. the `--format=json` double-encoding (a JSON-string meta comes back as a
 *      JSON string OF a JSON string),
 *   2. the json-string serialization required on write (a decoded PHP array
 *      makes Elementor render the page empty),
 *   3. the mandatory CSS-cache flush after a direct meta write.
 */

export interface ElementorSection {
  id?: string;
  elType?: string;
  isInner?: boolean;
  settings?: { _css_classes?: string; [k: string]: unknown };
  elements?: unknown[];
  [k: string]: unknown;
}

/**
 * Decode a raw `_elementor_data` payload into the section array. Handles a
 * plain array, a single JSON-encoded string, and the double-encoded form that
 * `wp post meta get --format=json` produces on a JSON-string meta.
 */
export function decodeElementorData(raw: unknown): ElementorSection[] {
  let parsed: unknown = raw;
  // Up to two JSON.parse passes (double-encoded scalar string).
  for (let i = 0; i < 2 && typeof parsed === "string"; i++) {
    const s = parsed.trim();
    if (s === "") return [];
    parsed = JSON.parse(s);
  }
  if (!Array.isArray(parsed)) {
    throw new WplabError(
      "ELEMENTOR_DATA_INVALID",
      "_elementor_data did not decode to a section array",
      { decoded_type: typeof parsed },
    );
  }
  return parsed as ElementorSection[];
}

function requireMetaCapable(target: Target, label: string): void {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker" &&
    !(target.kind === "rest" && target.companion?.enabled)
  ) {
    throw new WplabError(
      "ELEMENTOR_META_UNAVAILABLE",
      `${label} needs a shell-capable target (local/ssh/docker) OR a RestTarget with the rolepod-wp companion enabled — REST does not expose _elementor_data.`,
      { target_kind: target.kind },
    );
  }
}

/** Read + decode the full section tree of a post's `_elementor_data`. */
export async function readElementorData(
  target: Target,
  postId: number,
): Promise<ElementorSection[]> {
  requireMetaCapable(target, "readElementorData");
  const meta = await target.wpCli([
    "post",
    "meta",
    "get",
    String(postId),
    "_elementor_data",
    "--format=json",
  ]);
  if (meta.exitCode !== 0) {
    throw new WplabError(
      "ELEMENTOR_READ_FAILED",
      `could not read _elementor_data for post ${postId}: ${meta.stderr.slice(0, 200) || meta.stdout.slice(0, 200)}`,
      { post_id: postId },
    );
  }
  if (meta.stdout.trim() === "") return [];
  return decodeElementorData(meta.stdout);
}

/**
 * Write a section tree back to `_elementor_data` (json-string serialization)
 * and flush the Elementor CSS cache so the front-end reflects it immediately.
 * Pass `{ flush: false }` to skip the flush (e.g. when batching several writes).
 */
export async function writeElementorData(
  target: Target,
  postId: number,
  sections: unknown[],
  opts: { flush?: boolean } = {},
): Promise<{ bytesWritten: number; backupPath: string | null }> {
  requireMetaCapable(target, "writeElementorData");
  const res = await replacePostMeta(target, postId, "_elementor_data", sections, {
    backupPrefix: "elementor",
    serialization: "json-string",
  });
  if (opts.flush !== false) {
    await flushElementorCss(target);
  }
  return res;
}
