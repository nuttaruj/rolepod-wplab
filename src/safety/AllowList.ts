// wp-cli subcommand allow-list. Hard-coded per W-005 (no config).
// See brief/04-runtime-layer.md "Allow-list of wp-cli subcommands".
//
// Enforced in the `rolepod_wp_cli_run` handler, so it applies to every target
// kind. Every subcommand name below is verified against wp-cli 2.12.0 help
// output — an entry for a subcommand that does not exist is worse than no
// entry, because it reads as coverage the tool does not have.

import { isReadOnlySql } from "./DbGuard.js";

const READ_ONLY = new Set<string>([
  "cli",
  "cli info",
  "cli version",
  "core version",
  "core check-update",
  "core is-installed", // `--network` makes it the multisite probe
  "core verify-checksums",
  "db check",
  "db size",
  "option get",
  "option list",
  "plugin status",
  "plugin list",
  "plugin get",
  "plugin verify-checksums",
  "theme status",
  "theme list",
  "theme get",
  "post list",
  "post get",
  "user list",
  "user get",
  "user list-caps",
  "site list",
  "rewrite list",
  "config get",
  "config list",
  "cron event list",
  "language core list",
  "language plugin list",
  "language theme list",
  "transient list",
  "cache type",
  "user session list",
  "maintenance-mode status",
  "role list",
  "role get",
  "role exists",
  "cap list",
  "term list",
  "term get",
  "comment list",
  "comment get",
]);

const DESTRUCTIVE = new Set<string>([
  "core download",
  "core update",
  "core update-db",
  "core install",
  "config set",
  "config delete",
  "maintenance-mode activate",
  "maintenance-mode deactivate",
  // `rewrite flush` and `media regenerate` are benign but they do write. They
  // belong behind allow_destructive, not in READ_ONLY.
  "rewrite flush",
  "media import",
  "media regenerate",
  "role create",
  "role delete",
  "cap add",
  "cap remove",
  "term create",
  "term update",
  "term delete",
  "comment update",
  "comment approve",
  "comment unapprove",
  "comment spam",
  "comment unspam",
  "comment trash",
  "comment untrash",
  "comment delete",
  "user add-role",
  "user remove-role",
  "user set-role",
  "user add-cap",
  "user remove-cap",
  "theme delete",
  "plugin install",
  "plugin activate",
  "plugin deactivate",
  "plugin update",
  "plugin delete",
  "theme install",
  "theme activate",
  "theme update",
  "option update",
  "option add",
  "option delete",
  "post create",
  "post update",
  "post delete",
  "user create",
  "user update",
  "user delete",
  "user session destroy",
  "eval-file",
  "cron event run",
  "cron event delete",
  "cron event schedule",
  "cache flush",
  "transient delete",
  "transient delete-expired",
  "db export",
  "db import",
  "search-replace",
  "wpml",
  "gf",
  // Page-cache plugin purge commands (WS6). Each writes (clears a cache), so
  // they live behind allow_destructive. Only commands with a verified CLI are
  // here — see src/lib/cacheLayers.ts.
  "litespeed-purge",
  "rocket",
  "w3-total-cache",
]);

const NEVER_ALLOWED = new Set<string>([
  "db reset",
  "db drop",
  "db clean", // removes every table with the site's prefix
  "core multisite-convert",
  "role reset", // wipes every capability on every default role, site-wide
  "eval", // raw eval is the companion's job, never wp-cli passthrough
]);

export type AllowListVerdict =
  | { allowed: true; kind: "read_only" | "destructive" }
  | { allowed: false; kind: "not_in_allowlist" | "never_allowed" };

/**
 * Inspect wp-cli args and return whether the leading subcommand is allowed.
 *
 * Match order (most-specific wins): 3-token prefix → 2-token → single token.
 * "Never-allowed" checked first; "read_only" beats "destructive" at same depth.
 */
export function checkWpCli(
  args: readonly string[],
  allowDestructive: boolean,
): AllowListVerdict {
  if (args.length === 0) return { allowed: false, kind: "not_in_allowlist" };

  const head = args[0]!;
  const twoToken = args.length >= 2 ? `${head} ${args[1]}` : null;
  const threeToken = args.length >= 3 ? `${head} ${args[1]} ${args[2]}` : null;

  if (threeToken && NEVER_ALLOWED.has(threeToken))
    return { allowed: false, kind: "never_allowed" };
  if (twoToken && NEVER_ALLOWED.has(twoToken))
    return { allowed: false, kind: "never_allowed" };
  if (NEVER_ALLOWED.has(head)) return { allowed: false, kind: "never_allowed" };

  if (twoToken === "db query") return checkDbQuery(args, allowDestructive);
  if (twoToken === "user delete" && !hasReassign(args)) {
    return { allowed: false, kind: "not_in_allowlist" };
  }

  if (threeToken && READ_ONLY.has(threeToken))
    return { allowed: true, kind: "read_only" };
  if (threeToken && DESTRUCTIVE.has(threeToken)) {
    return allowDestructive
      ? { allowed: true, kind: "destructive" }
      : { allowed: false, kind: "not_in_allowlist" };
  }

  if (twoToken && READ_ONLY.has(twoToken))
    return { allowed: true, kind: "read_only" };
  if (READ_ONLY.has(head)) return { allowed: true, kind: "read_only" };

  if (twoToken && DESTRUCTIVE.has(twoToken)) {
    return allowDestructive
      ? { allowed: true, kind: "destructive" }
      : { allowed: false, kind: "not_in_allowlist" };
  }
  if (DESTRUCTIVE.has(head)) {
    return allowDestructive
      ? { allowed: true, kind: "destructive" }
      : { allowed: false, kind: "not_in_allowlist" };
  }

  return { allowed: false, kind: "not_in_allowlist" };
}

/**
 * `db query` runs whatever SQL it is handed. Classify by the SQL, not by the
 * subcommand: a single read statement is read-only, anything else needs
 * allow_destructive. Stacked statements never classify as read-only.
 */
function checkDbQuery(
  args: readonly string[],
  allowDestructive: boolean,
): AllowListVerdict {
  const sql = args.slice(2).find((a) => !a.startsWith("-"));
  if (sql !== undefined && isReadOnlySql(sql)) {
    return { allowed: true, kind: "read_only" };
  }
  return allowDestructive
    ? { allowed: true, kind: "destructive" }
    : { allowed: false, kind: "not_in_allowlist" };
}

/**
 * `wp user delete` reassigns nothing by default — every post the user authored
 * is deleted with them. Refuse the command unless the caller said where the
 * content goes.
 */
function hasReassign(args: readonly string[]): boolean {
  return args.some((a) => a === "--reassign" || a.startsWith("--reassign="));
}

export const _exposed_for_tests = { READ_ONLY, DESTRUCTIVE, NEVER_ALLOWED };
