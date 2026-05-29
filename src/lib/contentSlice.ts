/**
 * Range / grep / byte-cap slicing for large text payloads, so reading a 36 KB
 * theme CSS or a 100 KB rendered page doesn't blow the MCP result token cap.
 * Used by file_read and render_get. Pure, no I/O.
 */

export interface SliceOpts {
  /** 1-based start line (inclusive). */
  offset?: number;
  /** Max number of lines from `offset`. */
  limit?: number;
  /** Regex (string) — return only matching lines (+/- context). */
  grep?: string;
  /** Lines of context around each grep match. Default 0. */
  context?: number;
  /** Case-insensitive grep. Default false. */
  ignoreCase?: boolean;
  /** Hard cap on returned UTF-8 byte length. Truncates the (already sliced) result. */
  maxBytes?: number;
}

export interface SliceResult {
  content: string;
  /** Whether ANY slicing/truncation was applied. */
  sliced: boolean;
  /** Byte length of the original full text. */
  totalBytes: number;
  /** Byte length of the returned content. */
  returnedBytes: number;
  /** True when maxBytes truncated the result. */
  truncated: boolean;
  /** For grep mode: number of lines that matched the pattern. */
  matchedLines?: number;
}

const byteLen = (s: string): number =>
  typeof Buffer !== "undefined"
    ? Buffer.byteLength(s, "utf8")
    : new TextEncoder().encode(s).length;

function capBytes(
  s: string,
  maxBytes: number,
): { text: string; truncated: boolean } {
  if (byteLen(s) <= maxBytes) return { text: s, truncated: false };
  // Trim by characters until under the byte cap (UTF-8 chars are <=4 bytes).
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLen(s.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { text: s.slice(0, lo), truncated: true };
}

export function sliceContent(full: string, opts: SliceOpts = {}): SliceResult {
  const totalBytes = byteLen(full);
  let sliced = false;
  let matchedLines: number | undefined;
  let body = full;

  if (opts.grep !== undefined && opts.grep !== "") {
    sliced = true;
    const flags = opts.ignoreCase ? "i" : "";
    const re = new RegExp(opts.grep, flags);
    const lines = full.split("\n");
    const ctx = Math.max(0, opts.context ?? 0);
    const keep = new Set<number>();
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i]!)) {
        hits++;
        for (
          let j = Math.max(0, i - ctx);
          j <= Math.min(lines.length - 1, i + ctx);
          j++
        ) {
          keep.add(j);
        }
      }
    }
    matchedLines = hits;
    body = [...keep]
      .sort((a, b) => a - b)
      .map((i) => lines[i]!)
      .join("\n");
  } else if (opts.offset !== undefined || opts.limit !== undefined) {
    sliced = true;
    const lines = full.split("\n");
    const start = Math.max(0, (opts.offset ?? 1) - 1);
    const end = opts.limit !== undefined ? start + opts.limit : lines.length;
    body = lines.slice(start, end).join("\n");
  }

  let truncated = false;
  if (opts.maxBytes !== undefined && opts.maxBytes > 0) {
    const capped = capBytes(body, opts.maxBytes);
    if (capped.truncated) {
      body = capped.text;
      truncated = true;
      sliced = true;
    }
  }

  return {
    content: body,
    sliced,
    totalBytes,
    returnedBytes: byteLen(body),
    truncated,
    ...(matchedLines !== undefined ? { matchedLines } : {}),
  };
}
