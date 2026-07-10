import { DbWriteBlockedError } from "../util/errors.js";

const READ_ONLY_PREFIXES = ["select", "show", "describe", "desc", "explain"];

/**
 * SELECT-only SQL guard (W-007).
 *
 * Default posture: only read statements pass. The caller can override via
 * `allowWrite: true` for the rare case where a write is genuinely needed —
 * production guard still applies on top.
 *
 * We strip leading WITH (CTE) blocks before checking the head so common
 * `WITH foo AS (...) SELECT ...` patterns aren't false-flagged as writes.
 */
export function assertReadOnlyOrAllowed(
  sql: string,
  allowWrite: boolean,
): void {
  if (allowWrite) return;
  if (!isReadOnlySql(sql)) throw new DbWriteBlockedError(sql);
}

/**
 * True when `sql` is a single read statement.
 *
 * Stacked statements are rejected outright: `wp db query` and mysql both run
 * every `;`-separated statement, so inspecting only the head would wave
 * `SELECT 1; DELETE FROM wp_posts` through as read-only.
 */
export function isReadOnlySql(sql: string): boolean {
  const stripped = stripLeadingComments(sql).trim();
  if (!stripped) return false;
  if (hasStackedStatements(stripped)) return false;

  const head = stripped.toLowerCase();
  // Allow WITH foo AS (...) SELECT ...
  const afterWith = head.startsWith("with ") ? stripWithBlock(head) : head;

  return READ_ONLY_PREFIXES.some(
    (p) =>
      afterWith === p ||
      afterWith.startsWith(p + " ") ||
      afterWith.startsWith(p + "\n"),
  );
}

/**
 * True when a `;` separates two statements. String literals and backtick-quoted
 * identifiers are removed first so a semicolon inside `WHERE name = 'a;b'`
 * doesn't count. A single trailing `;` is fine.
 */
function hasStackedStatements(sql: string): boolean {
  const withoutLiterals = sql
    .replace(/'(?:[^'\\]|\\.|'')*'/g, "''")
    .replace(/"(?:[^"\\]|\\.|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, "``");
  return /;\s*\S/.test(withoutLiterals);
}

/** Drop leading SQL line/block comments. */
function stripLeadingComments(sql: string): string {
  let s = sql;
  // Loop because we may have multiple consecutive comments
  for (let i = 0; i < 50; i++) {
    const before = s.length;
    s = s.replace(/^\s*--[^\n]*\n/, "").replace(/^\s*\/\*[\s\S]*?\*\//, "");
    if (s.length === before) return s;
  }
  return s;
}

/** Walk past a `WITH ... ` CTE block; returns whatever follows. */
function stripWithBlock(sqlLowered: string): string {
  let depth = 0;
  let i = 5; // after 'with '
  while (i < sqlLowered.length) {
    const ch = sqlLowered[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (depth === 0) {
      // After the last closing paren of a CTE, the next non-space token is
      // either another CTE (`, foo AS (...)`) or the main statement.
      // Cheapest: if we see select/insert/update/delete, that's the statement head.
      const rest = sqlLowered.slice(i).trimStart();
      for (const p of READ_ONLY_PREFIXES) {
        if (
          rest === p ||
          rest.startsWith(p + " ") ||
          rest.startsWith(p + "\n")
        ) {
          return rest;
        }
      }
      // unknown — fall through and let the read-only check reject
    }
    i++;
  }
  return sqlLowered;
}

export const _exposed_for_tests = {
  READ_ONLY_PREFIXES,
  stripLeadingComments,
  stripWithBlock,
};
