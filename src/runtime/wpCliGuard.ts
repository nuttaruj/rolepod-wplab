import { WpCliBlockedError } from "../util/errors.js";
import type { Target, WpCliOpts, WpCliResult } from "./Target.js";

/**
 * Commands that destroy the site beyond recovery. Blocked for every caller,
 * on every target kind, with no opt-out — `allow_destructive` does not reach
 * this layer.
 *
 * Narrower than AllowList's NEVER_ALLOWED: `eval` is deliberately absent.
 * Five internal tools shell out to `wp eval` (replacePostMeta,
 * rolepodCustomOps, wp_mail_test, wp_elementor_publish, wp_elementor_restore),
 * so blocking it here would break them. `eval` stays blocked at the
 * `rolepod_wp_cli_run` handler, which is the only path an AI can reach it by.
 *
 * Verified against wp-cli 2.12.0 `wp db --help`:
 *   reset → "Removes all tables from the database."
 *   drop  → "Deletes the existing database."
 *   clean → "Removes all tables with `$table_prefix` from the database."
 */
const CATASTROPHIC: readonly (readonly string[])[] = [
  ["db", "reset"],
  ["db", "drop"],
  ["db", "clean"],
  ["core", "multisite-convert"],
];

const GUARDED: unique symbol = Symbol.for("rolepod.wplab.guardedTarget");

/**
 * wp-cli accepts global parameters before the subcommand
 * (`wp --path=/srv --yes db reset`), so a naive prefix match on args[0] is
 * bypassable. Drop every `-`-prefixed token before matching.
 */
function commandTokens(args: readonly string[]): string[] {
  return args
    .filter((a) => !a.startsWith("-"))
    .map((a) => a.toLowerCase().trim());
}

export function isCatastrophicWpCli(args: readonly string[]): boolean {
  const tokens = commandTokens(args);
  return CATASTROPHIC.some((cmd) => cmd.every((tok, i) => tokens[i] === tok));
}

export function isGuardedTarget(target: Target): boolean {
  return (target as Target & { [GUARDED]?: true })[GUARDED] === true;
}

/**
 * Wrap a Target so `wpCli()` can never run a catastrophic subcommand.
 *
 * Applied once, in `TargetRegistry.register()` — the single chokepoint every
 * Target passes through. Idempotent: re-wrapping an already-guarded Target
 * returns it unchanged.
 */
export function guardTarget(target: Target): Target {
  if (isGuardedTarget(target)) return target;

  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop === GUARDED) return true;
      if (prop !== "wpCli") {
        const value = Reflect.get(t, prop, receiver);
        return typeof value === "function" ? value.bind(t) : value;
      }
      // `async` so a blocked command rejects rather than throwing
      // synchronously — callers await, and a sync throw escapes their .catch().
      return async (
        args: readonly string[],
        opts?: WpCliOpts,
      ): Promise<WpCliResult> => {
        if (isCatastrophicWpCli(args)) {
          throw new WpCliBlockedError([...args], "never_allowed");
        }
        return t.wpCli(args, opts);
      };
    },
    has(t, prop) {
      if (prop === GUARDED) return true;
      return Reflect.has(t, prop);
    },
  });
}

export const _exposed_for_tests = { CATASTROPHIC, commandTokens };
