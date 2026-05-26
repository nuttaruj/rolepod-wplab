import { randomBytes } from "node:crypto";
import { RestClient } from "./restClient.js";
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { Credential } from "../credentials/types.js";
import type {
  CompanionStatus,
  FileWriteOpts,
  RestRequest,
  RestResponse,
  Target,
  WpCliOpts,
  WpCliResult,
} from "./Target.js";

const COMPANION_HANDSHAKE_TIMEOUT_MS = 5_000;

/**
 * RestTarget — Target implementation that reaches a remote WordPress over
 * HTTPS + REST + (optional) companion REST endpoints. No host-side wp-cli,
 * no SSH, no filesystem assumption.
 *
 * Capabilities by tier:
 *   - Always works:  rest()  (built-in WP REST routes)
 *   - With companion v0.1+: handshake, introspect, executePhp (when wired into v0.2)
 *   - With companion v0.2+: wpCli, fileRead, fileWrite (via companion endpoints)
 *
 * Without companion, wpCli / fileRead / fileWrite throw CompanionUnavailableError.
 */
export class RestTarget implements Target {
  readonly id: string;
  readonly kind = "rest" as const;
  readonly siteurl: string;
  readonly wpVersion: string;
  readonly phpVersion?: string;
  readonly companion: CompanionStatus;

  private readonly _client: RestClient;
  private readonly _credentialSite: string;

  private constructor(args: {
    id: string;
    siteurl: string;
    wpVersion: string;
    phpVersion?: string;
    client: RestClient;
    companion: CompanionStatus;
    credentialSite: string;
  }) {
    this.id = args.id;
    this.siteurl = args.siteurl;
    this.wpVersion = args.wpVersion;
    if (args.phpVersion !== undefined) this.phpVersion = args.phpVersion;
    this._client = args.client;
    this.companion = args.companion;
    this._credentialSite = args.credentialSite;
  }

  /**
   * Open a target against a remote WP via REST. Probes:
   *   1. /wp-json/wp/v2/types       — verifies REST + auth
   *   2. /wp-json/                  — pulls site metadata (name, description)
   *   3. /wp-json/wplab/v1/handshake — optional companion probe
   */
  static async open(args: {
    url: string;
    credential: Credential;
  }): Promise<RestTarget> {
    const client = new RestClient({
      baseUrl: args.url,
      credential: args.credential,
    });

    // Probe auth + REST reachability
    const probe = await client.request({
      method: "GET",
      path: "/wp/v2/types",
      timeoutMs: 10_000,
    });
    if (probe.status === 401 || probe.status === 403) {
      throw new WplabError(
        "REST_AUTH_FAILED",
        `REST auth failed (HTTP ${probe.status}) — check Application Password for ${args.credential.username}@${args.credential.site}`,
        { site: args.credential.site, status: probe.status },
      );
    }
    if (probe.status < 200 || probe.status >= 300) {
      throw new WplabError(
        "REST_PROBE_FAILED",
        `REST probe returned HTTP ${probe.status} — site may not have REST enabled or URL is wrong`,
        { site: args.credential.site, status: probe.status },
      );
    }

    // Pull site metadata
    const meta = await client.request({
      method: "GET",
      path: "/",
      timeoutMs: 10_000,
    });
    const wpVersion = extractWpVersion(meta.body);

    // Companion handshake (optional)
    let companion: CompanionStatus = null;
    try {
      const hs = await client.request({
        method: "GET",
        path: "/wplab/v1/handshake",
        timeoutMs: COMPANION_HANDSHAKE_TIMEOUT_MS,
      });
      if (hs.status === 200 && hs.body && typeof hs.body === "object") {
        const b = hs.body as {
          companion_version?: string;
          capabilities?: string[];
          php_version?: string;
        };
        companion = {
          installed: true,
          enabled: true,
          version: b.companion_version ?? null,
          capabilities: b.capabilities ?? [],
        };
      } else {
        log.debug("companion handshake non-200", { status: hs.status });
      }
    } catch (err) {
      // 404 / network error / timeout — companion absent
      log.debug("companion handshake failed", { err: (err as Error).message });
    }

    const target = new RestTarget({
      id: makeTargetId(),
      siteurl: args.url,
      wpVersion,
      client,
      companion,
      credentialSite: args.credential.site,
    });

    log.info("RestTarget opened", {
      id: target.id,
      siteurl: target.siteurl,
      wpVersion: target.wpVersion,
      companion: !!companion,
    });

    return target;
  }

  rootPath(): string {
    return this.siteurl;
  }

  async wpCli(
    _args: readonly string[],
    _opts?: WpCliOpts,
  ): Promise<WpCliResult> {
    throw new WplabError(
      "COMPANION_REQUIRED_V0_2",
      "wpCli via RestTarget requires companion v0.2+ (bundled wp-cli endpoint not yet shipped). Use LocalTarget or SshTarget for wp-cli access in v0.1.",
      { targetId: this.id, kind: this.kind },
    );
  }

  async rest(req: RestRequest): Promise<RestResponse> {
    const reqInit: Parameters<RestClient["request"]>[0] = { path: req.path };
    if (req.method !== undefined) reqInit.method = req.method;
    if (req.query !== undefined) reqInit.query = req.query;
    if (req.body !== undefined) reqInit.body = req.body;
    if (req.headers !== undefined) reqInit.headers = req.headers;
    const r = await this._client.request(reqInit);
    return { status: r.status, body: r.body, headers: r.headers };
  }

  async fileRead(
    _path: string,
  ): Promise<{ content: string; bytes: number; absolutePath: string }> {
    throw new WplabError(
      "COMPANION_REQUIRED_V0_2",
      "fileRead via RestTarget requires companion v0.2+ (fs-read endpoint not yet shipped).",
      { targetId: this.id },
    );
  }

  async fileWrite(
    _path: string,
    _content: string,
    _opts?: FileWriteOpts,
  ): Promise<{
    bytesWritten: number;
    backupPath: string | null;
    absolutePath: string;
  }> {
    throw new WplabError(
      "COMPANION_REQUIRED_V0_2",
      "fileWrite via RestTarget requires companion v0.2+ (fs-write endpoint not yet shipped).",
      { targetId: this.id },
    );
  }

  async fileExists(_path: string): Promise<boolean> {
    throw new WplabError(
      "COMPANION_REQUIRED_V0_2",
      "fileExists via RestTarget requires companion v0.2+.",
      { targetId: this.id },
    );
  }

  async close(): Promise<void> {
    // v0.2: revoke companion session token here.
    log.info("RestTarget closed", { id: this.id, site: this._credentialSite });
  }
}

function makeTargetId(): string {
  return `tgt_${randomBytes(6).toString("hex")}`;
}

function extractWpVersion(metaBody: unknown): string {
  if (metaBody && typeof metaBody === "object") {
    const m = metaBody as Record<string, unknown>;
    // WP REST root sometimes exposes version via X-WP headers or a custom field
    if (typeof m["_wp_version"] === "string") return m["_wp_version"];
    if (typeof m["wp_version"] === "string") return m["wp_version"];
  }
  return "unknown";
}
