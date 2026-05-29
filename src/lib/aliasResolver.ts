/**
 * Alias resolver — bridge between AI-friendly `@demo` target ids and the
 * ephemeral `tgt_<hex>` ids the TargetRegistry hands out.
 *
 * Workflow at dispatch time:
 *
 * 1. Tool call arrives with `target_id: "@demo"`.
 * 2. resolveAliasInArgs() detects the prefix, looks up "demo" in the
 *    on-disk alias store, asks the registry for an existing live session
 *    for that alias. If none → opens a fresh RestTarget via openTarget().
 * 3. We rewrite args.target_id to the live `tgt_<hex>` and remember the
 *    alias so the dispatcher knows to reconnect-and-retry on
 *    TargetNotFoundError.
 *
 * Why an in-memory map (alias → live target id)? The registry idle-closes
 * targets after 10 min; we don't want to write that closure back to disk.
 * The map is the cheap cache; the disk is the source of truth.
 */
import {
  AliasStore,
  looksLikeAlias,
  aliasNameFromValue,
} from "./targetAliases.js";
import { WplabError, TargetNotFoundError } from "../util/errors.js";
import { log } from "../util/log.js";
import { openTarget } from "../runtime/factory.js";
import { makeVault } from "../credentials/factory.js";
import { canonicalizeSite } from "../credentials/types.js";
import type { TargetRegistry } from "../target/TargetRegistry.js";

export interface AliasResolverDeps {
  registry: TargetRegistry;
  store?: AliasStore;
}

/**
 * Track which alias was used to last open which live target id. Single
 * process-global map — collisions are by design (per alias, only one live
 * session at a time).
 */
const aliasToTargetId = new Map<string, string>();
const targetIdToAlias = new Map<string, string>();

export function rememberAliasMapping(alias: string, targetId: string): void {
  const prior = aliasToTargetId.get(alias);
  if (prior) targetIdToAlias.delete(prior);
  aliasToTargetId.set(alias, targetId);
  targetIdToAlias.set(targetId, alias);
}

export function forgetAliasMapping(alias: string): void {
  const tid = aliasToTargetId.get(alias);
  if (tid) targetIdToAlias.delete(tid);
  aliasToTargetId.delete(alias);
}

export function aliasFor(targetId: string): string | null {
  return targetIdToAlias.get(targetId) ?? null;
}

/**
 * Look up an alias on disk, return an open target id for it. Reuses an
 * existing live session if the registry still holds it, otherwise opens
 * a fresh RestTarget.
 */
export async function openAlias(
  deps: AliasResolverDeps,
  alias: string,
): Promise<string> {
  const store = deps.store ?? new AliasStore();
  const entry = await store.get(alias);
  if (!entry) {
    throw new WplabError(
      "ALIAS_NOT_FOUND",
      `target alias "${alias}" is not configured. Add with: rolepod_wp_target_alias { action: "set", alias: "${alias}", siteurl: "https://your-site.com" }`,
      { alias },
    );
  }

  // Try cached live session first.
  const cachedId = aliasToTargetId.get(alias);
  if (cachedId) {
    try {
      deps.registry.get(cachedId);
      return cachedId;
    } catch {
      // Live session gone (idle-closed) — fall through to reconnect.
      forgetAliasMapping(alias);
    }
  }

  // Fresh connect.
  const vault = await makeVault();
  const credLookup = entry.credential_ref || canonicalizeSite(entry.siteurl);
  const cred = await vault.get(credLookup);
  if (!cred) {
    throw new WplabError(
      "ALIAS_CREDENTIALS_MISSING",
      `alias "${alias}" points at ${entry.siteurl} but no credentials are stored for ${credLookup}. Run rolepod-wplab credentials add ${credLookup} (or repair via rolepod_wp_pair).`,
      { alias, credential_lookup: credLookup },
    );
  }
  const target = await openTarget({
    kind: "rest",
    url: entry.siteurl,
    credential: cred,
  });
  deps.registry.register(target);
  await vault.touch(credLookup);
  await store.touch(alias);
  rememberAliasMapping(alias, target.id);
  log.info("alias resolved", { alias, target_id: target.id });
  return target.id;
}

/**
 * Read tool arguments, if `target_id` is an alias like `@demo`, resolve
 * to a live `tgt_<hex>` and return both the rewritten args and the alias
 * name (so the caller can reconnect-and-retry on TargetNotFoundError).
 *
 * Returns null alias when input wasn't aliased — args returned as-is.
 */
export async function resolveAliasInArgs(
  deps: AliasResolverDeps,
  args: unknown,
): Promise<{ args: unknown; alias: string | null }> {
  if (!args || typeof args !== "object") return { args, alias: null };
  const a = args as Record<string, unknown>;
  if (!looksLikeAlias(a["target_id"])) {
    return { args, alias: null };
  }
  const alias = aliasNameFromValue(a["target_id"] as string);
  const targetId = await openAlias(deps, alias);
  return { args: { ...a, target_id: targetId }, alias };
}

/**
 * Wrap a tool handler so that when it throws TargetNotFoundError AND the
 * original args used an alias, we re-resolve the alias (forcing a fresh
 * connect) and retry once. Other errors propagate unchanged.
 */
export async function withAliasReconnect<T>(
  deps: AliasResolverDeps,
  alias: string | null,
  args: unknown,
  fn: (args: unknown) => Promise<T>,
): Promise<T> {
  if (!alias) return fn(args);
  try {
    return await fn(args);
  } catch (err) {
    if (!(err instanceof TargetNotFoundError)) throw err;
    log.info("alias auto-reconnect", { alias, after: err.message });
    forgetAliasMapping(alias);
    const newId = await openAlias(deps, alias);
    const retryArgs =
      args && typeof args === "object"
        ? { ...(args as Record<string, unknown>), target_id: newId }
        : args;
    return await fn(retryArgs);
  }
}
