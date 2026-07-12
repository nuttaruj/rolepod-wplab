/**
 * Safe embedding of runtime values into generated PHP source.
 *
 * Every helper here turns a JS value into a PHP *expression* that is immune to
 * breaking out of its context — the whole point is that a user-supplied string
 * like `'; system('rm -rf /'); //` embeds as inert data, never as code.
 *
 * Pick the helper by the SINK, not by the value:
 *
 *   - `phpQuote`   → the value lands in a PHP single-quoted string literal.
 *                     Use for labels, titles, slugs, any plain string.
 *   - `phpLiteral` → a string | number | boolean literal (numbers/bools bare).
 *   - `phpJsonArg` → the PHP code does `json_decode($x, true)` (or otherwise
 *                     wants a decoded array/scalar). Emits
 *                     `json_decode('<json>', true)` so nested structures survive
 *                     intact — do NOT use `phpQuote(JSON.stringify(...))` for a
 *                     decoded-array sink, and do NOT use `phpJsonArg` for a sink
 *                     that stores the raw string verbatim (that mangles it into
 *                     the literal "Array").
 *   - `escapeBlockComment` → the value lands inside a `/* ... *\/` docblock.
 */

/** Embed `s` as a PHP single-quoted string literal (escapes `\` then `'`). */
export function phpQuote(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

/** Embed a string | number | boolean as its PHP literal form. */
export function phpLiteral(v: string | number | boolean): string {
  if (typeof v === "string") return phpQuote(v);
  if (typeof v === "number") return String(v);
  return v ? "true" : "false";
}

/**
 * Embed `v` for a sink that decodes JSON — emits `json_decode('<json>', true)`
 * so arrays/objects reconstruct exactly. The JSON string is itself embedded via
 * phpQuote, so no payload can break out of the literal.
 */
export function phpJsonArg(v: unknown): string {
  return `json_decode(${phpQuote(JSON.stringify(v))}, true)`;
}

/** Neutralize `*\/` so `s` can sit inside a PHP block comment without closing it. */
export function escapeBlockComment(s: string): string {
  return s.replace(/\*\//g, "* /");
}
