// wp-cli subcommand allow-list. Hard-coded per W-005 (no config).
// See brief/04-runtime-layer.md "Allow-list of wp-cli subcommands".

const READ_ONLY = new Set<string>([
  'cli',
  'cli info',
  'cli version',
  'core version',
  'core check-update',
  'db check',
  'db size',
  'option get',
  'option list',
  'plugin status',
  'plugin list',
  'theme status',
  'theme list',
  'post list',
  'post get',
  'user list',
  'user get',
  'site list',
  'rewrite list',
  'config get',
  'config list',
  'cron event list',
  'language core list',
  'language plugin list',
  'language theme list',
])

const DESTRUCTIVE = new Set<string>([
  'core download',
  'core update',
  'core install',
  'plugin install',
  'plugin activate',
  'plugin deactivate',
  'plugin update',
  'plugin delete',
  'theme install',
  'theme activate',
  'theme update',
  'option update',
  'option add',
  'option delete',
  'post create',
  'post update',
  'post delete',
  'user create',
  'user update',
  'user delete',
  'eval-file',
])

const NEVER_ALLOWED = new Set<string>([
  'db reset',
  'db drop',
  'core multisite-convert',
  'eval', // raw eval is the companion's job, never wp-cli passthrough
])

export type AllowListVerdict =
  | { allowed: true; kind: 'read_only' | 'destructive' }
  | { allowed: false; kind: 'not_in_allowlist' | 'never_allowed' }

/**
 * Inspect wp-cli args and return whether the leading subcommand is allowed.
 *
 * We match the longest 2-token prefix (e.g. "plugin list") then fall back to
 * the leading single token ("cli"). Anything not in any set is blocked.
 */
export function checkWpCli(args: readonly string[], allowDestructive: boolean): AllowListVerdict {
  if (args.length === 0) return { allowed: false, kind: 'not_in_allowlist' }

  const head = args[0]!
  const twoToken = args.length >= 2 ? `${head} ${args[1]}` : null

  if (twoToken && NEVER_ALLOWED.has(twoToken)) return { allowed: false, kind: 'never_allowed' }
  if (NEVER_ALLOWED.has(head)) return { allowed: false, kind: 'never_allowed' }

  if (twoToken && READ_ONLY.has(twoToken)) return { allowed: true, kind: 'read_only' }
  if (READ_ONLY.has(head)) return { allowed: true, kind: 'read_only' }

  if (twoToken && DESTRUCTIVE.has(twoToken)) {
    return allowDestructive
      ? { allowed: true, kind: 'destructive' }
      : { allowed: false, kind: 'not_in_allowlist' }
  }
  if (DESTRUCTIVE.has(head)) {
    return allowDestructive
      ? { allowed: true, kind: 'destructive' }
      : { allowed: false, kind: 'not_in_allowlist' }
  }

  return { allowed: false, kind: 'not_in_allowlist' }
}

export const _exposed_for_tests = { READ_ONLY, DESTRUCTIVE, NEVER_ALLOWED }
