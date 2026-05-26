import type { Target } from "../runtime/Target.js";

/**
 * Adapter contract (W-023).
 *
 * Each ecosystem plugin (Elementor / WooCommerce / ACF / Bricks / WPML / …)
 * implements one Adapter. Composites + tools delegate plugin-specific work
 * to the matching adapter so the runtime + tool layers stay plugin-agnostic.
 *
 * Adapter responsibilities:
 *   - detect() — return true if the plugin is active on the target
 *   - read    — typed read operations; should work without companion when
 *               possible (REST / wp-cli fallbacks)
 *   - write?  — optional, gated by allow_destructive + production guard.
 *               Falls back to companion executePhp when no public API exists.
 *
 * Adapters MUST NOT reach into runtime internals — only call Target methods.
 */
export interface Adapter<TRead, TWrite = never> {
  /** Lowercase slug — must match the WP plugin slug exactly. */
  readonly slug: string;

  /** Optional human-readable name for diagnostics. */
  readonly name?: string;

  /** Range of plugin versions this adapter is tested against. */
  readonly supportedRange?: { min: string; testedUpTo: string };

  /** Cheap probe: is the plugin active on this target? */
  detect(target: Target): Promise<boolean>;

  /** Plugin-version-discovery for warning when outside testedRange. */
  versionOn?(target: Target): Promise<string | null>;

  /** Typed read methods. */
  read: TRead;

  /** Optional typed write methods. */
  write?: TWrite;
}

/**
 * AdapterUnavailableError — thrown by adapter methods when the underlying
 * operation requires a transport that isn't available on the current target
 * (e.g. needs companion executePhp but companion absent).
 */
export class AdapterUnavailableError extends Error {
  readonly adapter: string;
  readonly reason: string;

  constructor(adapter: string, reason: string) {
    super(`Adapter '${adapter}' unavailable: ${reason}`);
    this.name = "AdapterUnavailableError";
    this.adapter = adapter;
    this.reason = reason;
  }
}
