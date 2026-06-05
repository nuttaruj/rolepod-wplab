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

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string;
  enable_agentic: boolean;
  enable_prompt: boolean;
}

export interface SkillRecord extends SkillCatalogEntry {
  content: string;
  skill_md: string;
}

export interface SkillWriteResult {
  slug: string;
  action: string;
  warnings: string[];
  audit_id: string;
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
          timeout_seconds: Math.min(
            120,
            Math.max(1, opts.timeoutSeconds ?? 30),
          ),
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
  ): {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    auditId: string;
  } {
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
  ): Promise<{
    bytesWritten: number;
    backupPath: string | null;
    absolutePath: string;
  }> {
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

  // ─── v2.3 Change Ledger ─────────────────────────────────────────────────

  /**
   * Record an AI-issued change into the ledger so the user (or AI itself) can
   * query and toggle it later. The MCP-side writer tools call this right after
   * a successful write — before+after state are captured at the moment of the
   * write so the rollback path is mechanical.
   */
  async recordChange(input: {
    category: string;
    subcategory: string;
    targetDescriptor: string;
    beforeState?: unknown;
    afterState?: unknown;
    reversible?: boolean;
    sourceTool?: string;
    sourceSession?: string;
    notes?: string;
  }): Promise<{ auditId: string }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/changes/record",
      body: {
        session_token: token,
        category: input.category,
        subcategory: input.subcategory,
        target_descriptor: input.targetDescriptor,
        before_state: input.beforeState,
        after_state: input.afterState,
        reversible: input.reversible ?? true,
        source_tool: input.sourceTool,
        source_session: input.sourceSession,
        notes: input.notes,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "LEDGER_RECORD_FAILED",
        `record change returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    return {
      auditId: ((res.body ?? {}) as { audit_id?: string }).audit_id ?? "",
    };
  }

  async queryChanges(
    filters: {
      category?: string;
      applied?: boolean;
      sinceMinutes?: number;
      sourceSession?: string;
      limit?: number;
    } = {},
  ): Promise<{ count: number; rows: Array<Record<string, unknown>> }> {
    const token = await this.ensureFreshToken();
    const query: Record<string, string | number | boolean> = {
      session_token: token,
    };
    if (filters.category) query["category"] = filters.category;
    if (filters.applied !== undefined) query["applied"] = filters.applied;
    if (filters.sinceMinutes !== undefined)
      query["since_minutes"] = filters.sinceMinutes;
    if (filters.sourceSession) query["source_session"] = filters.sourceSession;
    if (filters.limit !== undefined) query["limit"] = filters.limit;

    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/changes",
      query,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "LEDGER_QUERY_FAILED",
        `query changes returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const b = (res.body ?? {}) as {
      count?: number;
      rows?: Array<Record<string, unknown>>;
    };
    return { count: b.count ?? 0, rows: b.rows ?? [] };
  }

  async toggleChange(id: number, applied: boolean): Promise<unknown> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/changes/toggle",
      body: { session_token: token, id, applied },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "LEDGER_TOGGLE_FAILED",
        `toggle change returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    return res.body;
  }

  async toggleChangesBulk(
    ids: readonly number[],
    applied: boolean,
  ): Promise<unknown> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/changes/toggle-bulk",
      body: { session_token: token, ids: [...ids], applied },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "LEDGER_TOGGLE_BULK_FAILED",
        `bulk toggle returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    return res.body;
  }

  async panicChanges(sinceMinutes: number): Promise<unknown> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/changes/panic",
      body: { session_token: token, since_minutes: sinceMinutes },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "LEDGER_PANIC_FAILED",
        `panic returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    return res.body;
  }

  // ─── v2.4 Pre-write syntax check + Theme snapshot/restore ───────────

  /**
   * Server-side validate a PHP or JSON payload before file_write commits it.
   * Returns { ok: true } when valid, or { ok: false, errorCode, errorLine,
   * errorMessage } when invalid. If the companion can't run php -l (exec
   * disabled), returns ok=null and the caller decides whether to proceed
   * un-validated.
   */
  async syntaxCheck(
    language: "php" | "json",
    content: string,
  ): Promise<{
    ok: boolean | null;
    errorCode?: string;
    errorLine?: number | null;
    errorMessage?: string;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/syntax-check",
      body: { session_token: token, language, content },
    });
    if (res.status === 503) {
      // exec disabled — caller falls back.
      return { ok: null, errorCode: "EXEC_DISABLED" };
    }
    if (res.status < 200 || res.status >= 300) {
      // Unexpected error — treat as "couldn't validate", caller decides.
      return { ok: null, errorCode: `HTTP_${res.status}` };
    }
    const b = (res.body ?? {}) as {
      ok?: boolean;
      error_code?: string;
      error_line?: number | null;
      error_message?: string;
    };
    if (b.ok === true) return { ok: true };
    return {
      ok: false,
      errorCode: b.error_code ?? "VALIDATION_FAILED",
      errorLine: b.error_line ?? null,
      errorMessage: b.error_message ?? "",
    };
  }

  /**
   * Snapshot a theme directory to wp-content/uploads/rolepod-wp-theme-snapshots/
   * as a .tar.gz. Returns the absolute path for use in subsequent restore.
   */
  async themeSnapshot(stylesheet: string): Promise<{
    stylesheet: string;
    path: string;
    bytes: number;
    fileCount: number;
    auditId: string;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/theme/snapshot",
      body: { session_token: token, stylesheet },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `THEME_SNAPSHOT_HTTP_${res.status}`,
        b.error_message ?? `theme snapshot returned HTTP ${res.status}`,
        { status: res.status, stylesheet },
      );
    }
    const b = (res.body ?? {}) as {
      stylesheet?: string;
      path?: string;
      bytes?: number;
      file_count?: number;
      audit_id?: string;
    };
    return {
      stylesheet: b.stylesheet ?? stylesheet,
      path: b.path ?? "",
      bytes: b.bytes ?? 0,
      fileCount: b.file_count ?? 0,
      auditId: b.audit_id ?? "",
    };
  }

  /**
   * Mint a one-time wp-admin login URL. Companion stores a 5-min single-use
   * transient; URL form: `<siteurl>/?rolepod_wp_otl=<hex>`. WP's init hook
   * intercepts the param, validates, calls wp_set_auth_cookie, redirects.
   * Used by browser-automation flows + by AI to surface a one-shot admin
   * link to the user without exposing the admin password.
   */
  async adminOneTimeLink(destination?: string): Promise<{
    url: string;
    token: string;
    expiresInSeconds: number;
    destination: string;
  }> {
    const token = await this.ensureFreshToken();
    const body: Record<string, unknown> = { session_token: token };
    if (destination !== undefined) body["destination"] = destination;
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/admin/one-time-login",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `ONE_TIME_LOGIN_HTTP_${res.status}`,
        b.error_message ?? `one-time login mint returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const b = (res.body ?? {}) as {
      url?: string;
      token?: string;
      expires_in_seconds?: number;
      destination?: string;
    };
    return {
      url: b.url ?? "",
      token: b.token ?? "",
      expiresInSeconds: b.expires_in_seconds ?? 300,
      destination: b.destination ?? "",
    };
  }

  /**
   * Rename a file via companion `/fs-rename`. Used by wp_file_disable +
   * wp_file_enable to toggle a file by suffixing `.disabled`.
   */
  async fsRename(
    src: string,
    dest: string,
  ): Promise<{ src: string; dest: string; auditId: string }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/fs-rename",
      body: { session_token: token, src, dest },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `FS_RENAME_HTTP_${res.status}`,
        b.error_message ?? `fs-rename returned HTTP ${res.status}`,
        { status: res.status, src, dest },
      );
    }
    const b = (res.body ?? {}) as {
      src?: string;
      dest?: string;
      audit_id?: string;
    };
    return {
      src: b.src ?? src,
      dest: b.dest ?? dest,
      auditId: b.audit_id ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // v2.7.1 — SELECT-only DB query (bypass wp-cli `db query` shell-escape hazards)
  //
  // wp-cli's `db query` over the companion exec endpoint requires careful
  // shell quoting + does NOT substitute `{prefix}` placeholders. The
  // companion `/db-query` endpoint binds via $wpdb->prepare + replaces
  // `{prefix}` with the actual table prefix server-side. Used by diagnose
  // (slow_queries, large_options) and any other read-only DB introspection.
  // Refuses non-SELECT statements at companion level.
  // -------------------------------------------------------------------------

  async dbQuery(
    sql: string,
    params?: ReadonlyArray<string | number>,
  ): Promise<{
    rows: Array<Record<string, unknown>>;
    count: number;
    auditId: string;
  }> {
    const token = await this.ensureFreshToken();
    const body: Record<string, unknown> = { session_token: token, sql };
    if (params !== undefined) body["params"] = params;
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/db-query",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `DB_QUERY_HTTP_${res.status}`,
        b.error_message ?? `db-query returned HTTP ${res.status}`,
        { status: res.status, sql_preview: sql.slice(0, 200) },
      );
    }
    const b = (res.body ?? {}) as {
      rows?: Array<Record<string, unknown>>;
      count?: number;
      audit_id?: string;
    };
    return {
      rows: Array.isArray(b.rows) ? b.rows : [],
      count: typeof b.count === "number" ? b.count : 0,
      auditId: b.audit_id ?? "",
    };
  }

  // -------------------------------------------------------------------------
  // v2.7 — Direct wp_options access (bypass REST /wp/v2/settings allowlist)
  //
  // REST /wp/v2/settings only exposes ~10 fields under different names than
  // raw wp_options (title vs blogname, description vs blogdescription,
  // timezone vs timezone_string). Writing the raw wp_options name to REST
  // settings silently no-ops. These methods use companion's /option-set and
  // /option-get endpoints which call update_option() / get_option() directly.
  // -------------------------------------------------------------------------

  async optionSet(
    name: string,
    value: unknown,
    autoload?: "yes" | "no",
  ): Promise<{
    name: string;
    changed: boolean;
    previous: unknown;
    current: unknown;
    auditId: string;
  }> {
    const token = await this.ensureFreshToken();
    const body: Record<string, unknown> = {
      session_token: token,
      name,
      value,
    };
    if (autoload !== undefined) body["autoload"] = autoload;
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/option-set",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `OPTION_SET_HTTP_${res.status}`,
        b.error_message ?? `option-set returned HTTP ${res.status}`,
        { status: res.status, name },
      );
    }
    const b = (res.body ?? {}) as {
      name?: string;
      changed?: boolean;
      previous?: unknown;
      current?: unknown;
      audit_id?: string;
    };
    return {
      name: b.name ?? name,
      changed: !!b.changed,
      previous: b.previous ?? null,
      current: b.current ?? null,
      auditId: b.audit_id ?? "",
    };
  }

  async optionGet(
    name: string,
    defaultValue?: unknown,
  ): Promise<{ name: string; value: unknown; exists: boolean }> {
    const token = await this.ensureFreshToken();
    const body: Record<string, unknown> = { session_token: token, name };
    if (defaultValue !== undefined) body["default"] = defaultValue;
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/option-get",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `OPTION_GET_HTTP_${res.status}`,
        b.error_message ?? `option-get returned HTTP ${res.status}`,
        { status: res.status, name },
      );
    }
    const b = (res.body ?? {}) as {
      name?: string;
      value?: unknown;
      exists?: boolean;
    };
    return {
      name: b.name ?? name,
      value: b.value ?? null,
      exists: !!b.exists,
    };
  }

  // -------------------------------------------------------------------------
  // v2.6 — Recovery namespace (mu-plugin guardian, /wplab-recovery/v1/*)
  //
  // These bypass the main companion namespace entirely. Used when the main
  // plugin parse-errors or fatals — the mu-plugin guardian loaded earlier in
  // WP boot and registered these endpoints independently. Auth = WP-native
  // Application Password (target.rest() carries it), so we don't need a
  // session token (which would require the main /handshake endpoint alive).
  // -------------------------------------------------------------------------

  async recoveryStatus(): Promise<{
    ok: boolean;
    guardianVersion: string;
    mainAlive: boolean;
    mainVersion: string | null;
    safeMode: boolean;
    recentFatals: Array<Record<string, unknown>>;
    lastFatal: Record<string, unknown> | null;
    wpVersion: string | null;
    phpVersion: string;
    siteurl: string | null;
  }> {
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab-recovery/v1/status",
    });
    if (res.status === 404) {
      throw new WplabError(
        "GUARDIAN_NOT_INSTALLED",
        "Recovery guardian mu-plugin not found. Install main rolepod-wp plugin v2.6+ and activate to deploy the guardian.",
        { status: res.status },
      );
    }
    if (res.status === 403) {
      throw new WplabError(
        "GUARDIAN_UNAUTHORIZED",
        "Recovery guardian rejected the call — needs manage_options + valid Application Password.",
        { status: res.status },
      );
    }
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        `GUARDIAN_HTTP_${res.status}`,
        `recovery status returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const b = (res.body ?? {}) as Record<string, unknown>;
    return {
      ok: !!b["ok"],
      guardianVersion: (b["guardian_version"] as string) ?? "",
      mainAlive: !!b["main_alive"],
      mainVersion: (b["main_version"] as string | null) ?? null,
      safeMode: !!b["safe_mode"],
      recentFatals: Array.isArray(b["recent_fatals"])
        ? (b["recent_fatals"] as Array<Record<string, unknown>>)
        : [],
      lastFatal: (b["last_fatal"] as Record<string, unknown> | null) ?? null,
      wpVersion: (b["wp_version"] as string | null) ?? null,
      phpVersion: (b["php_version"] as string) ?? "",
      siteurl: (b["siteurl"] as string | null) ?? null,
    };
  }

  async recoveryDisablePlugin(plugin: string): Promise<{
    disabledFile: string;
    originalFile: string;
    plugin: string;
  }> {
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab-recovery/v1/disable-plugin",
      body: { plugin },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as { error_code?: string };
      throw new WplabError(
        b.error_code ?? `RECOVERY_DISABLE_PLUGIN_HTTP_${res.status}`,
        `recovery disable-plugin returned HTTP ${res.status}`,
        { status: res.status, plugin },
      );
    }
    const b = (res.body ?? {}) as {
      disabled_file?: string;
      original_file?: string;
      plugin?: string;
    };
    return {
      disabledFile: b.disabled_file ?? "",
      originalFile: b.original_file ?? "",
      plugin: b.plugin ?? plugin,
    };
  }

  async recoveryDisableFile(
    path: string,
  ): Promise<{ src: string; dest: string }> {
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab-recovery/v1/disable-file",
      body: { path },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as { error_code?: string };
      throw new WplabError(
        b.error_code ?? `RECOVERY_DISABLE_FILE_HTTP_${res.status}`,
        `recovery disable-file returned HTTP ${res.status}`,
        { status: res.status, path },
      );
    }
    const b = (res.body ?? {}) as { src?: string; dest?: string };
    return { src: b.src ?? path, dest: b.dest ?? `${path}.disabled` };
  }

  async recoveryRestoreFile(
    path: string,
  ): Promise<{ src: string; dest: string }> {
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab-recovery/v1/restore-file",
      body: { path },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as { error_code?: string };
      throw new WplabError(
        b.error_code ?? `RECOVERY_RESTORE_FILE_HTTP_${res.status}`,
        `recovery restore-file returned HTTP ${res.status}`,
        { status: res.status, path },
      );
    }
    const b = (res.body ?? {}) as { src?: string; dest?: string };
    return { src: b.src ?? "", dest: b.dest ?? "" };
  }

  async recoveryRestoreSnapshot(snapshotPath: string): Promise<{
    restoredTheme: string;
    snapshotPath: string;
    targetDir: string;
  }> {
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab-recovery/v1/restore-snapshot",
      body: { snapshot_path: snapshotPath },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `RECOVERY_RESTORE_SNAPSHOT_HTTP_${res.status}`,
        b.error_message ??
          `recovery restore-snapshot returned HTTP ${res.status}`,
        { status: res.status, snapshotPath },
      );
    }
    const b = (res.body ?? {}) as {
      restored_theme?: string;
      snapshot_path?: string;
      target_dir?: string;
    };
    return {
      restoredTheme: b.restored_theme ?? "",
      snapshotPath: b.snapshot_path ?? snapshotPath,
      targetDir: b.target_dir ?? "",
    };
  }

  async recoveryListChanges(limit = 50): Promise<{
    changes: Array<Record<string, unknown>>;
    count: number;
  }> {
    const res = await this.target.rest({
      method: "GET",
      path: `/wplab-recovery/v1/list-changes?limit=${encodeURIComponent(String(limit))}`,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        `RECOVERY_LIST_CHANGES_HTTP_${res.status}`,
        `recovery list-changes returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const b = (res.body ?? {}) as {
      changes?: Array<Record<string, unknown>>;
      count?: number;
    };
    return {
      changes: Array.isArray(b.changes) ? b.changes : [],
      count: typeof b.count === "number" ? b.count : 0,
    };
  }

  async recoverySafeMode(enabled: boolean): Promise<{ safeMode: boolean }> {
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab-recovery/v1/safe-mode",
      body: { enabled },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        `RECOVERY_SAFE_MODE_HTTP_${res.status}`,
        `recovery safe-mode returned HTTP ${res.status}`,
        { status: res.status },
      );
    }
    const b = (res.body ?? {}) as { safe_mode?: boolean };
    return { safeMode: !!b.safe_mode };
  }

  async themeRestore(snapshotPath: string): Promise<{
    stylesheet: string;
    filesRestored: number;
    auditId: string;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/theme/restore",
      body: { session_token: token, snapshot_path: snapshotPath },
    });
    if (res.status < 200 || res.status >= 300) {
      const b = (res.body ?? {}) as {
        error_code?: string;
        error_message?: string;
      };
      throw new WplabError(
        b.error_code ?? `THEME_RESTORE_HTTP_${res.status}`,
        b.error_message ?? `theme restore returned HTTP ${res.status}`,
        { status: res.status, snapshotPath },
      );
    }
    const b = (res.body ?? {}) as {
      stylesheet?: string;
      files_restored?: number;
      audit_id?: string;
    };
    return {
      stylesheet: b.stylesheet ?? "",
      filesRestored: b.files_restored ?? 0,
      auditId: b.audit_id ?? "",
    };
  }

  // ─── v2.11 — Phase 2 endpoints ──────────────────────────────────────────

  async fileWriteBatch(
    writes: ReadonlyArray<{
      path: string;
      content: string;
      mode?: "overwrite" | "append";
      confirmUnsafePath?: boolean;
    }>,
    opts: { skipPhpLint?: boolean } = {},
  ): Promise<{
    batchId: string;
    written: Array<{
      path: string;
      absolutePath: string;
      bytesWritten: number;
      backupPath: string | null;
    }>;
    preflight: {
      phpLintRan: boolean;
      requireChainRan: boolean;
      entriesScanned: number;
    };
  }> {
    const token = await this.ensureFreshToken();
    const body = {
      session_token: token,
      writes: writes.map((w) => ({
        path: w.path,
        content: w.content,
        mode: w.mode ?? "overwrite",
        confirm_unsafe_path: w.confirmUnsafePath ?? false,
      })),
      skip_php_lint: opts.skipPhpLint ?? false,
    };
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/fs-write-batch",
      body,
    });
    if (res.status === 401) {
      const fresh = await this.handshake();
      const retry = await this.target.rest({
        method: "POST",
        path: "/wplab/v1/fs-write-batch",
        body: { ...body, session_token: fresh.session_token },
      });
      return this.coerceBatchResponse(retry.status, retry.body);
    }
    return this.coerceBatchResponse(res.status, res.body);
  }

  private coerceBatchResponse(
    status: number,
    body: unknown,
  ): {
    batchId: string;
    written: Array<{
      path: string;
      absolutePath: string;
      bytesWritten: number;
      backupPath: string | null;
    }>;
    preflight: {
      phpLintRan: boolean;
      requireChainRan: boolean;
      entriesScanned: number;
    };
  } {
    const b = (body ?? {}) as Record<string, unknown>;
    if (status >= 200 && status < 300 && b["ok"] === true) {
      const writtenRaw = Array.isArray(b["written"])
        ? (b["written"] as Array<Record<string, unknown>>)
        : [];
      const pre = (b["preflight"] as Record<string, unknown> | undefined) ?? {};
      return {
        batchId:
          typeof b["batch_id"] === "string" ? (b["batch_id"] as string) : "",
        written: writtenRaw.map((w) => ({
          path: typeof w["path"] === "string" ? (w["path"] as string) : "",
          absolutePath:
            typeof w["absolute_path"] === "string"
              ? (w["absolute_path"] as string)
              : "",
          bytesWritten:
            typeof w["bytes_written"] === "number"
              ? (w["bytes_written"] as number)
              : 0,
          backupPath:
            typeof w["backup_path"] === "string"
              ? (w["backup_path"] as string)
              : null,
        })),
        preflight: {
          phpLintRan: !!pre["php_lint_ran"],
          requireChainRan: !!pre["require_chain_ran"],
          entriesScanned:
            typeof pre["entries_scanned"] === "number"
              ? (pre["entries_scanned"] as number)
              : 0,
        },
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `FS_WRITE_BATCH_HTTP_${status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `fs-write-batch via companion returned HTTP ${status}`,
      {
        status,
        failed_index: b["failed_index"],
        failed_path: b["failed_path"],
        missing_requires: b["missing_requires"],
        error_line: b["error_line"],
      },
    );
  }

  async dirEnsure(
    path: string,
  ): Promise<{ path: string; absolutePath: string; created: boolean }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/dir-ensure",
      body: { session_token: token, path },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return {
        path: typeof b["path"] === "string" ? (b["path"] as string) : path,
        absolutePath:
          typeof b["absolute_path"] === "string"
            ? (b["absolute_path"] as string)
            : "",
        created: !!b["created"],
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `DIR_ENSURE_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `dir-ensure HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async fileCopy(
    from: string,
    to: string,
    opts: { overwrite?: boolean } = {},
  ): Promise<{ from: string; to: string; bytes: number }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/fs-copy",
      body: {
        session_token: token,
        from,
        to,
        overwrite: opts.overwrite ?? false,
      },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return {
        from: typeof b["from"] === "string" ? (b["from"] as string) : from,
        to: typeof b["to"] === "string" ? (b["to"] as string) : to,
        bytes: typeof b["bytes"] === "number" ? (b["bytes"] as number) : 0,
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `FS_COPY_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `fs-copy HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async fileList(
    path: string,
    opts: { depth?: number; includeHidden?: boolean } = {},
  ): Promise<{
    root: string;
    entries: Array<{
      path: string;
      type: "file" | "dir";
      bytes: number;
      mtime: number;
      depth: number;
    }>;
    truncated: boolean;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/fs-list",
      query: {
        session_token: token,
        path,
        depth: opts.depth ?? 2,
        include_hidden: opts.includeHidden ?? false,
      },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      const rawEntries = Array.isArray(b["entries"])
        ? (b["entries"] as Array<Record<string, unknown>>)
        : [];
      return {
        root: typeof b["root"] === "string" ? (b["root"] as string) : path,
        entries: rawEntries.map((e) => ({
          path: typeof e["path"] === "string" ? (e["path"] as string) : "",
          type: e["type"] === "dir" ? "dir" : "file",
          bytes: typeof e["bytes"] === "number" ? (e["bytes"] as number) : 0,
          mtime: typeof e["mtime"] === "number" ? (e["mtime"] as number) : 0,
          depth: typeof e["depth"] === "number" ? (e["depth"] as number) : 0,
        })),
        truncated: !!b["truncated"],
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `FS_LIST_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `fs-list HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async elementorWidgetSchema(
    widget?: string,
  ): Promise<Record<string, unknown>> {
    const token = await this.ensureFreshToken();
    const query: Record<string, string | number | boolean> = {
      session_token: token,
    };
    if (widget !== undefined && widget !== "") query["widget"] = widget;
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/elementor/widget-schema",
      query,
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return b;
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `ELEMENTOR_WIDGET_SCHEMA_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `elementor widget-schema HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async elementorTemplateExport(
    postId: number,
  ): Promise<Record<string, unknown>> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/elementor/template-export",
      query: { session_token: token, post_id: postId },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return b;
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `ELEMENTOR_TEMPLATE_EXPORT_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `elementor template-export HTTP ${res.status}`,
      { status: res.status },
    );
  }

  // ─── v2.12 — Phase 3.2 endpoints ────────────────────────────────────────

  async elementorWidgetAttribute(
    postId: number,
    widgetId: string,
    attrs: Record<string, string>,
  ): Promise<{
    postId: number;
    widgetId: string;
    attrsNow: Record<string, string>;
    widgetsTotal: number;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/elementor/widget-attribute",
      body: {
        session_token: token,
        post_id: postId,
        widget_id: widgetId,
        attrs,
      },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return {
        postId:
          typeof b["post_id"] === "number" ? (b["post_id"] as number) : postId,
        widgetId:
          typeof b["widget_id"] === "string"
            ? (b["widget_id"] as string)
            : widgetId,
        attrsNow: (b["attrs_now"] ?? {}) as Record<string, string>,
        widgetsTotal:
          typeof b["widgets_total"] === "number"
            ? (b["widgets_total"] as number)
            : 0,
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `ELEMENTOR_WIDGET_ATTR_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `elementor widget-attribute HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async elementorTemplateApply(input: {
    targetPostId: number;
    sections: ReadonlyArray<Record<string, unknown>>;
    replaceStrings?: Record<string, string>;
    overwrite?: boolean;
  }): Promise<{
    targetPostId: number;
    sectionCount: number;
    replacementsApplied: number;
  }> {
    const token = await this.ensureFreshToken();
    const body: Record<string, unknown> = {
      session_token: token,
      target_post_id: input.targetPostId,
      sections: input.sections,
      overwrite: input.overwrite ?? false,
    };
    if (input.replaceStrings && Object.keys(input.replaceStrings).length > 0) {
      body["replace_strings"] = input.replaceStrings;
    }
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/elementor/template-apply",
      body,
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return {
        targetPostId:
          typeof b["target_post_id"] === "number"
            ? (b["target_post_id"] as number)
            : input.targetPostId,
        sectionCount:
          typeof b["section_count"] === "number"
            ? (b["section_count"] as number)
            : 0,
        replacementsApplied:
          typeof b["replacements_applied"] === "number"
            ? (b["replacements_applied"] as number)
            : 0,
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `ELEMENTOR_TEMPLATE_APPLY_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `elementor template-apply HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async jobCreate(input: {
    args: ReadonlyArray<string>;
    timeoutSeconds?: number;
    allowDestructive?: boolean;
  }): Promise<{
    jobId: string;
    pid: number;
    log: { stdout: string; stderr: string };
    startedAt: number;
    ttlSeconds: number;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "POST",
      path: "/wplab/v1/job/create",
      body: {
        session_token: token,
        args: input.args,
        timeout_seconds: input.timeoutSeconds ?? 600,
        allow_destructive: input.allowDestructive ?? false,
      },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      const log = (b["log"] ?? {}) as Record<string, unknown>;
      return {
        jobId: typeof b["job_id"] === "string" ? (b["job_id"] as string) : "",
        pid: typeof b["pid"] === "number" ? (b["pid"] as number) : 0,
        log: {
          stdout:
            typeof log["stdout"] === "string" ? (log["stdout"] as string) : "",
          stderr:
            typeof log["stderr"] === "string" ? (log["stderr"] as string) : "",
        },
        startedAt:
          typeof b["started_at"] === "number" ? (b["started_at"] as number) : 0,
        ttlSeconds:
          typeof b["ttl_seconds"] === "number"
            ? (b["ttl_seconds"] as number)
            : 3600,
      };
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `JOB_CREATE_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `job-create HTTP ${res.status}`,
      { status: res.status },
    );
  }

  async jobStatus(
    jobId: string,
    opts: { tail?: number } = {},
  ): Promise<{
    jobId: string;
    pid: number;
    args: string[];
    startedAt: number;
    state: "running" | "completed" | "failed" | "unknown";
    elapsedSeconds: number;
    stdoutTail: string;
    stderrTail: string;
    log: { stdout: string; stderr: string };
    exitCode?: number;
  }> {
    const token = await this.ensureFreshToken();
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/job/status",
      query: { session_token: token, job_id: jobId, tail: opts.tail ?? 8192 },
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      const log = (b["log"] ?? {}) as Record<string, unknown>;
      const state =
        typeof b["state"] === "string" ? (b["state"] as string) : "unknown";
      const out: {
        jobId: string;
        pid: number;
        args: string[];
        startedAt: number;
        state: "running" | "completed" | "failed" | "unknown";
        elapsedSeconds: number;
        stdoutTail: string;
        stderrTail: string;
        log: { stdout: string; stderr: string };
        exitCode?: number;
      } = {
        jobId:
          typeof b["job_id"] === "string" ? (b["job_id"] as string) : jobId,
        pid: typeof b["pid"] === "number" ? (b["pid"] as number) : 0,
        args: Array.isArray(b["args"]) ? (b["args"] as string[]) : [],
        startedAt:
          typeof b["started_at"] === "number" ? (b["started_at"] as number) : 0,
        state: (["running", "completed", "failed", "unknown"].includes(state)
          ? state
          : "unknown") as "running" | "completed" | "failed" | "unknown",
        elapsedSeconds:
          typeof b["elapsed_seconds"] === "number"
            ? (b["elapsed_seconds"] as number)
            : 0,
        stdoutTail:
          typeof b["stdout_tail"] === "string"
            ? (b["stdout_tail"] as string)
            : "",
        stderrTail:
          typeof b["stderr_tail"] === "string"
            ? (b["stderr_tail"] as string)
            : "",
        log: {
          stdout:
            typeof log["stdout"] === "string" ? (log["stdout"] as string) : "",
          stderr:
            typeof log["stderr"] === "string" ? (log["stderr"] as string) : "",
        },
      };
      if (typeof b["exit_code"] === "number")
        out.exitCode = b["exit_code"] as number;
      return out;
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `JOB_STATUS_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `job-status HTTP ${res.status}`,
      { status: res.status },
    );
  }

  // --- site-owned skills (companion v2.13+) -------------------------------

  private requireSkills(): void {
    if (!this.hasCapability("skills")) {
      throw new CompanionUnavailableError(
        this.target.id,
        "skills capability not advertised — upgrade the companion plugin to v2.13+",
      );
    }
  }

  /**
   * Build a WplabError that carries the companion's structured repair hints
   * (suggested_slug, warnings, …) through to the agent so it can self-correct
   * without a second probe round-trip.
   */
  private skillError(
    status: number,
    body: unknown,
    prefix: string,
  ): WplabError {
    const b = (body ?? {}) as Record<string, unknown>;
    const { ok: _ok, error_code, error_message, ...rest } = b;
    return new WplabError(
      typeof error_code === "string" ? error_code : `${prefix}_HTTP_${status}`,
      typeof error_message === "string"
        ? (error_message as string)
        : `${prefix} returned HTTP ${status}`,
      { status, ...rest },
    );
  }

  /** Discovery view — slug + description + flags, no bodies. */
  async skillCatalog(): Promise<SkillCatalogEntry[]> {
    this.requireSkills();
    const res = await this.target.rest({
      method: "GET",
      path: "/wplab/v1/skills",
    });
    const b = (res.body ?? {}) as {
      ok?: boolean;
      skills?: SkillCatalogEntry[];
    };
    if (res.status >= 200 && res.status < 300 && Array.isArray(b.skills)) {
      return b.skills;
    }
    throw this.skillError(res.status, res.body, "SKILL_CATALOG");
  }

  /** Full record (incl. body + rendered SKILL.md) by slug; null when absent. */
  async skillGet(slug: string): Promise<SkillRecord | null> {
    this.requireSkills();
    const res = await this.target.rest({
      method: "GET",
      path: `/wplab/v1/skills/${encodeURIComponent(slug)}`,
    });
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      if (b["found"] !== true) return null;
      return {
        slug: String(b["slug"] ?? slug),
        name: String(b["name"] ?? ""),
        description: String(b["description"] ?? ""),
        content: String(b["content"] ?? ""),
        skill_md: String(b["skill_md"] ?? ""),
        enable_agentic: b["enable_agentic"] === true,
        enable_prompt: b["enable_prompt"] === true,
      };
    }
    throw this.skillError(res.status, res.body, "SKILL_GET");
  }

  // ---------------------------------------------------------------------------
  // v1.23 — server-side companion engines: media-optimize + site backup/restore.
  // These wrap the rolepod-wp companion's throttled endpoints (the work runs in
  // WP on a cron loop; the MCP just starts/polls/inspects).
  // ---------------------------------------------------------------------------

  /**
   * Thin JSON call to a companion endpoint. Injects a fresh session token when
   * `withToken` is true (writes), sends GET params as query, POST as body, and
   * throws a typed WplabError on a non-2xx companion response.
   */
  private async companionCall(
    method: "GET" | "POST",
    path: string,
    payload: Record<string, unknown> = {},
    withToken = true,
  ): Promise<Record<string, unknown>> {
    const merged = withToken
      ? { session_token: await this.ensureFreshToken(), ...payload }
      : payload;
    const res = await this.target.rest(
      method === "GET"
        ? {
            method,
            path,
            query: merged as Record<string, string | number | boolean>,
          }
        : { method, path, body: merged },
    );
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300) {
      return b;
    }
    throw new WplabError(
      typeof b["error_code"] === "string"
        ? (b["error_code"] as string)
        : `COMPANION_HTTP_${res.status}`,
      typeof b["error_message"] === "string"
        ? (b["error_message"] as string)
        : `${path} returned HTTP ${res.status}`,
      { status: res.status, path },
    );
  }

  async mediaOptimize(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/media-optimize", input);
  }

  async backupStart(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/backup-start", input);
  }

  async backupStatus(): Promise<Record<string, unknown>> {
    return this.companionCall("GET", "/wplab/v1/backup-status", {}, false);
  }

  async backupList(): Promise<Record<string, unknown>> {
    return this.companionCall("GET", "/wplab/v1/backup-list", {}, false);
  }

  async backupInspect(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/backup-inspect", input, false);
  }

  async backupCancel(): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/backup-cancel", {});
  }

  async backupDelete(id: string): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/backup-delete", { id });
  }

  async restoreStart(
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.companionCall("POST", "/wplab/v1/backup-restore", input);
  }

  async restoreStatus(): Promise<Record<string, unknown>> {
    return this.companionCall(
      "GET",
      "/wplab/v1/backup-restore-status",
      {},
      false,
    );
  }

  /** Token + 401-retry envelope shared by the three skill mutations. */
  private async skillMutate(
    method: "POST" | "DELETE",
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const token = await this.ensureFreshToken();
    const send = (tok: string) =>
      method === "DELETE"
        ? this.target.rest({ method, path, query: { session_token: tok } })
        : this.target.rest({
            method,
            path,
            body: { ...body, session_token: tok },
          });

    let res = await send(token);
    if (res.status === 401) {
      const fresh = await this.handshake();
      res = await send(fresh.session_token);
    }
    const b = (res.body ?? {}) as Record<string, unknown>;
    if (res.status >= 200 && res.status < 300 && b["ok"] === true) {
      return b;
    }
    throw this.skillError(res.status, res.body, "SKILL_WRITE");
  }

  async skillWrite(input: {
    title: string;
    description?: string;
    content: string;
    enable_agentic?: boolean;
    enable_prompt?: boolean;
    on_conflict?: "fail" | "replace" | "rename";
  }): Promise<SkillWriteResult> {
    this.requireSkills();
    const body: Record<string, unknown> = {
      title: input.title,
      description: input.description ?? "",
      content: input.content,
    };
    if (input.enable_agentic !== undefined)
      body["enable_agentic"] = input.enable_agentic;
    if (input.enable_prompt !== undefined)
      body["enable_prompt"] = input.enable_prompt;
    if (input.on_conflict) body["on_conflict"] = input.on_conflict;

    const b = await this.skillMutate("POST", "/wplab/v1/skills", body);
    return {
      slug: String(b["slug"] ?? ""),
      action: String(b["action"] ?? ""),
      warnings: Array.isArray(b["warnings"]) ? (b["warnings"] as string[]) : [],
      audit_id: String(b["audit_id"] ?? ""),
    };
  }

  async skillEdit(
    slug: string,
    patch: {
      description?: string;
      content?: string;
      enable_agentic?: boolean;
      enable_prompt?: boolean;
    },
  ): Promise<{
    slug: string;
    action: string;
    skill: SkillRecord | null;
    audit_id: string;
  }> {
    this.requireSkills();
    const body: Record<string, unknown> = {};
    if (patch.description !== undefined)
      body["description"] = patch.description;
    if (patch.content !== undefined) body["content"] = patch.content;
    if (patch.enable_agentic !== undefined)
      body["enable_agentic"] = patch.enable_agentic;
    if (patch.enable_prompt !== undefined)
      body["enable_prompt"] = patch.enable_prompt;

    const b = await this.skillMutate(
      "POST",
      `/wplab/v1/skills/${encodeURIComponent(slug)}/edit`,
      body,
    );
    return {
      slug: String(b["slug"] ?? slug),
      action: String(b["action"] ?? "updated"),
      skill: (b["skill"] as SkillRecord | null) ?? null,
      audit_id: String(b["audit_id"] ?? ""),
    };
  }

  async skillDelete(slug: string): Promise<{
    slug: string;
    action: string;
    recoverable: boolean;
    audit_id: string;
  }> {
    this.requireSkills();
    const b = await this.skillMutate(
      "DELETE",
      `/wplab/v1/skills/${encodeURIComponent(slug)}`,
      {},
    );
    return {
      slug: String(b["slug"] ?? slug),
      action: String(b["action"] ?? "trashed"),
      recoverable: b["recoverable"] === true,
      audit_id: String(b["audit_id"] ?? ""),
    };
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

/**
 * Helper for recovery-namespace methods: build a Bridge WITHOUT calling
 * handshake(). The guardian's `/wplab-recovery/v1/*` endpoints authenticate
 * via WP-native Application Password (no session token needed) AND
 * intentionally work when the main `/wplab/v1/*` companion is dead. v1.11.4
 * recovery tools failed because they routed through `bridgeFor()` which
 * tries handshake first → 500 from broken WP → COMPANION_UNAVAILABLE → user
 * cannot recover.
 *
 * Use this in any tool that exclusively hits `/wplab-recovery/v1/*` paths.
 */
export async function bridgeForRecovery(
  target: Target,
): Promise<CompanionBridge> {
  try {
    await target.rest({ method: "GET", path: "/" });
  } catch (err) {
    const e = err as Error & { code?: string };
    if (e.code === "NOT_IMPLEMENTED") {
      throw new CompanionUnavailableError(
        target.id,
        "Target.rest() not implemented for this target kind",
      );
    }
  }
  return new CompanionBridge(target);
}
