import { assertPhpPayloadOk } from "../safety/AstScreen.js";
import {
  CompanionUnavailableError,
  ProductionBlockedError,
  WplabError,
} from "../util/errors.js";
import { COMPANION_INSTALL_URL } from "./constants.js";
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
        { installUrl: COMPANION_INSTALL_URL },
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

  /**
   * Run a wp-cli command through the companion's bundled phar.
   *
   * Companion executes via PHP `exec()` against `wp-content/uploads/wplab-bin/wp-cli.phar`.
   * The phar may not be installed yet — in that case the companion returns
   * 503 with `WP_CLI_NOT_BUNDLED`; callers can fetch the phar via fileWrite()
   * to bootstrap.
   *
   * Mirrors the WpCliResult shape used by LocalTarget/SshTarget/DockerTarget
   * so composite tools (audit_security, diagnose, cron_tool, cache_tool) work
   * uniformly across target kinds.
   */
  async wpCli(
    args: readonly string[],
    opts: { timeoutSeconds?: number } = {},
  ): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    auditId: string;
  }> {
    const startedAt = Date.now();
    const res = await this.postWpCli(args, opts);

    // Auto-bootstrap wp-cli.phar on first call if missing (idempotent on
    // companion side). Then retry the original wp-cli call once.
    if (res.status === 503) {
      const b = (res.body ?? {}) as {
        error_code?: string;
      };
      if (b.error_code === "WP_CLI_NOT_BUNDLED") {
        log.info("companion wp-cli.phar missing — bootstrapping from upstream");
        const ok = await this.bootstrapWpCli();
        if (ok) {
          const retry = await this.postWpCli(args, opts);
          return this.coerceWpCliResponse(
            retry.status,
            retry.body,
            Date.now() - startedAt,
          );
        }
      }
    }

    if (res.status === 401) {
      // Token may have expired between local TTL check and server check.
      // Re-handshake once + retry.
      const fresh = await this.handshake();
      const retry = await this.target.rest({
        method: "POST",
        path: "/wplab/v1/wp-cli",
        body: {
          session_token: fresh.session_token,
          args: [...args],
          timeout_seconds: Math.min(120, Math.max(1, opts.timeoutSeconds ?? 30)),
        },
      });
      return this.coerceWpCliResponse(
        retry.status,
        retry.body,
        Date.now() - startedAt,
      );
    }

    return this.coerceWpCliResponse(
      res.status,
      res.body,
      Date.now() - startedAt,
    );
  }

  private async postWpCli(
    args: readonly string[],
    opts: { timeoutSeconds?: number } = {},
  ) {
    const token = await this.ensureFreshToken();
    return this.target.rest({
      method: "POST",
      path: "/wplab/v1/wp-cli",
      body: {
        session_token: token,
        args: [...args],
        timeout_seconds: Math.min(120, Math.max(1, opts.timeoutSeconds ?? 30)),
      },
    });
  }

  /**
   * Ask the companion to pull wp-cli.phar from upstream and stash it at
   * wp-content/uploads/wplab-bin/wp-cli.phar. Idempotent. Returns true if the
   * phar is present after the call (already-present OR just-fetched).
   */
  private async bootstrapWpCli(): Promise<boolean> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/wp-cli/bootstrap",
      body: { session_token: token },
    });
    if (res.status === 200) {
      log.debug("companion wp-cli bootstrap ok", { body: res.body });
      return true;
    }
    log.warn("companion wp-cli bootstrap failed", {
      status: res.status,
      body: res.body,
    });
    return false;
  }

  private coerceWpCliResponse(
    status: number,
    body: unknown,
    durationMs: number,
  ): { exitCode: number; stdout: string; stderr: string; durationMs: number; auditId: string } {
    const b = (body ?? {}) as {
      ok?: boolean;
      exit_code?: number;
      stdout?: string;
      stderr?: string;
      error_code?: string;
      error_message?: string;
      audit_id?: string;
    };

    if (status >= 200 && status < 300) {
      return {
        exitCode: b.exit_code ?? 0,
        stdout: b.stdout ?? "",
        // Companion's WpCli endpoint merges stderr into stdout (2>&1); preserve that.
        stderr: b.stderr ?? "",
        durationMs,
        auditId: b.audit_id ?? "",
      };
    }
    throw new WplabError(
      b.error_code ?? `WP_CLI_HTTP_${status}`,
      b.error_message ?? `wp-cli via companion returned HTTP ${status}`,
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
        { installUrl: COMPANION_INSTALL_URL },
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

  /**
   * Read a file under ABSPATH via the companion's /fs-read endpoint.
   * Scope guard runs server-side (mirrors Node-side FileScope rules).
   */
  async fileRead(
    path: string,
  ): Promise<{ content: string; bytes: number; absolutePath: string }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/fs-read",
      body: { session_token: token, path },
    });
    if (res.status === 401) {
      const fresh = await this.handshake();
      const retry = await this.target.rest({
        method: "POST",
        path: "/wplab/v1/fs-read",
        body: { session_token: fresh.session_token, path },
      });
      return this.coerceFsReadResponse(retry.status, retry.body);
    }
    return this.coerceFsReadResponse(res.status, res.body);
  }

  private coerceFsReadResponse(
    status: number,
    body: unknown,
  ): { content: string; bytes: number; absolutePath: string } {
    const b = (body ?? {}) as {
      ok?: boolean;
      content?: string;
      bytes?: number;
      absolute_path?: string;
      error_code?: string;
      error_message?: string;
    };
    if (status >= 200 && status < 300) {
      return {
        content: b.content ?? "",
        bytes: b.bytes ?? 0,
        absolutePath: b.absolute_path ?? "",
      };
    }
    throw new WplabError(
      b.error_code ?? `FS_READ_HTTP_${status}`,
      b.error_message ?? `fs-read via companion returned HTTP ${status}`,
      { status },
    );
  }

  /**
   * Write a file under wp-content/{themes,plugins,uploads} (or wp-config.php
   * with confirmUnsafePath) via the companion's /fs-write endpoint.
   * Optional backup writes `.wplab-bak-YYYYMMDD-HHMMSS` next to the target.
   */
  async fileWrite(
    path: string,
    content: string,
    opts: {
      mode?: "overwrite" | "append";
      backup?: boolean;
      confirmUnsafePath?: boolean;
    } = {},
  ): Promise<{ bytesWritten: number; backupPath: string | null; absolutePath: string }> {
    const token = await this.ensureFreshToken();
    const body = {
      session_token: token,
      path,
      content,
      mode: opts.mode ?? "overwrite",
      backup: opts.backup ?? true,
      confirm_unsafe_path: opts.confirmUnsafePath ?? false,
    };
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/fs-write",
      body,
    });
    if (res.status === 401) {
      const fresh = await this.handshake();
      const retry = await this.target.rest({
        method: "POST",
        path: "/wplab/v1/fs-write",
        body: { ...body, session_token: fresh.session_token },
      });
      return this.coerceFsWriteResponse(retry.status, retry.body);
    }
    return this.coerceFsWriteResponse(res.status, res.body);
  }

  private coerceFsWriteResponse(
    status: number,
    body: unknown,
  ): { bytesWritten: number; backupPath: string | null; absolutePath: string } {
    const b = (body ?? {}) as {
      ok?: boolean;
      bytes_written?: number;
      backup_path?: string | null;
      absolute_path?: string;
      error_code?: string;
      error_message?: string;
    };
    if (status >= 200 && status < 300) {
      return {
        bytesWritten: b.bytes_written ?? 0,
        backupPath: b.backup_path ?? null,
        absolutePath: b.absolute_path ?? "",
      };
    }
    throw new WplabError(
      b.error_code ?? `FS_WRITE_HTTP_${status}`,
      b.error_message ?? `fs-write via companion returned HTTP ${status}`,
      { status },
    );
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
