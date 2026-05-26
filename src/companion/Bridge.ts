import { assertPhpPayloadOk } from "../safety/AstScreen.js";
import {
  CompanionUnavailableError,
  ProductionBlockedError,
  WplabError,
} from "../util/errors.js";
import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";

export interface HandshakeResponse {
  companion_version: string;
  wp_version: string;
  php_version?: string;
  siteurl: string;
  is_production: boolean;
  production_pattern_matched: string | null;
  capabilities: string[];
  session_token: string;
  session_ttl_seconds: number;
}

export interface ExecutePhpResponse {
  ok: boolean;
  return_value?: unknown;
  stdout?: string;
  duration_ms?: number;
  php_warnings?: string[];
  audit_id: string;
  error_code?: string;
  error_message?: string;
}

export interface IntrospectResponse {
  // Schema varies by scope — bridge passes through.
  [k: string]: unknown;
}

/**
 * Companion REST client wrapper. Manages session token TTL + AST pre-screen +
 * production guard short-circuit + auto-refresh.
 *
 * Pairs with companion v0.1+. Operates over any Target that has rest()
 * implemented (today: RestTarget; v0.3 SshTarget + DockerTarget will add it).
 */
export class CompanionBridge {
  private target: Target;
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private capabilities: ReadonlySet<string> = new Set();
  private isProductionMatched = false;

  constructor(target: Target) {
    this.target = target;
  }

  hasCapability(cap: string): boolean {
    return this.capabilities.has(cap);
  }

  isProduction(): boolean {
    return this.isProductionMatched;
  }

  /**
   * Probe + (re-)issue session token. Idempotent; safe to call before any
   * companion-gated op to keep the token fresh.
   */
  async handshake(): Promise<HandshakeResponse> {
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/handshake",
    });

    if (res.status === 404) {
      throw new CompanionUnavailableError(
        this.target.id,
        "companion plugin not installed or endpoints disabled",
      );
    }
    if (res.status === 403) {
      throw new CompanionUnavailableError(
        this.target.id,
        "companion refused — check Settings → WPLab Companion (enable endpoints + user has manage_options)",
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new CompanionUnavailableError(
        this.target.id,
        `handshake returned HTTP ${res.status}`,
      );
    }

    const body = res.body as HandshakeResponse | null;
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.session_token !== "string"
    ) {
      throw new CompanionUnavailableError(
        this.target.id,
        "handshake response missing session_token",
      );
    }

    this.token = body.session_token;
    this.tokenExpiresAt = Date.now() + body.session_ttl_seconds * 1000;
    this.capabilities = new Set(body.capabilities ?? []);
    this.isProductionMatched = !!body.is_production;

    log.debug("companion handshake ok", {
      version: body.companion_version,
      caps: body.capabilities,
      isProd: this.isProductionMatched,
    });

    return body;
  }

  /** Re-handshake if the token is missing or expires within 60s. */
  private async ensureFreshToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.token;
    }
    const hs = await this.handshake();
    return hs.session_token;
  }

  async executePhp(
    payload: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<ExecutePhpResponse> {
    // Pre-flight guards (Node side; companion re-screens server side)
    if (this.isProductionMatched) {
      throw new ProductionBlockedError(
        this.target.siteurl,
        "companion reports prod match",
      );
    }
    if (!this.hasCapability("execute_php")) {
      throw new CompanionUnavailableError(
        this.target.id,
        "execute_php capability not advertised — toggle ON in Settings → WPLab Companion",
      );
    }
    assertPhpPayloadOk(payload, "execute_php");

    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/execute-php",
      body: {
        session_token: token,
        payload,
        timeout_ms: opts.timeoutMs ?? 5000,
      },
    });

    if (res.status === 401) {
      // Token may have expired between local TTL check and server check.
      // Re-handshake once + retry.
      const fresh = await this.handshake();
      const retry = await this.target.rest({
        method: "POST",
        path: "/wplab/v1/execute-php",
        body: {
          session_token: fresh.session_token,
          payload,
          timeout_ms: opts.timeoutMs ?? 5000,
        },
      });
      return this.coerceExecutePhpResponse(retry.status, retry.body);
    }

    return this.coerceExecutePhpResponse(res.status, res.body);
  }

  private coerceExecutePhpResponse(
    status: number,
    body: unknown,
  ): ExecutePhpResponse {
    if (status >= 200 && status < 300) {
      const b = (body ?? {}) as ExecutePhpResponse;
      return { ...b, ok: !!b.ok, audit_id: b.audit_id ?? "" };
    }
    const b = (body ?? {}) as ExecutePhpResponse;
    throw new WplabError(
      b.error_code ?? `EXECUTE_PHP_HTTP_${status}`,
      b.error_message ?? `execute-php returned HTTP ${status}`,
      { audit_id: b.audit_id ?? "", status },
    );
  }

  async introspect(
    scope: string,
    opts: { includeValues?: boolean } = {},
  ): Promise<IntrospectResponse> {
    const query: Record<string, string | number | boolean> = { scope };
    if (opts.includeValues !== undefined)
      query["include_values"] = opts.includeValues;

    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/introspect",
      query,
    });

    if (res.status === 404) {
      throw new CompanionUnavailableError(
        this.target.id,
        "companion not installed",
      );
    }
    if (res.status === 403) {
      // Production-blocked or admin-disabled
      const b = res.body as {
        error_code?: string;
        error_message?: string;
      } | null;
      if (b?.error_code === "PRODUCTION_BLOCKED") {
        throw new ProductionBlockedError(
          this.target.siteurl,
          b.error_message ?? "production",
        );
      }
      throw new CompanionUnavailableError(
        this.target.id,
        b?.error_message ?? "forbidden",
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "INTROSPECT_FAILED",
        `introspect returned HTTP ${res.status}`,
        {
          status: res.status,
        },
      );
    }
    return (res.body ?? {}) as IntrospectResponse;
  }
}

/**
 * Helper: build a Bridge for a target. Throws CompanionUnavailableError if
 * the target's transport (LocalTarget v0.1/0.2) doesn't yet implement rest().
 */
export async function bridgeFor(target: Target): Promise<CompanionBridge> {
  // Probe rest() availability cheaply. LocalTarget throws NOT_IMPLEMENTED in
  // v0.1; if so, we wrap that as CompanionUnavailableError.
  try {
    await target.rest({ method: "GET", path: "/" });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "NOT_IMPLEMENTED") {
      throw new CompanionUnavailableError(
        target.id,
        "Target.rest() not implemented for this target kind — use RestTarget or wait for v0.3 SSH/Docker companion bridging",
      );
    }
    // Other errors (4xx/5xx during the probe) are tolerated — we only needed
    // to confirm the method works, not that the path exists.
  }
  const bridge = new CompanionBridge(target);
  await bridge.handshake();
  return bridge;
}
