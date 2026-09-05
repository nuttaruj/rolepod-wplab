import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { Credential } from "../credentials/types.js";

export interface RestClientOptions {
  baseUrl: string;
  credential: Credential;
  timeoutMs?: number;
  userAgent?: string;
}

export interface RestRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface RestResponseRaw {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thin HTTPS REST client for WordPress targets.
 *
 *   - Refuses non-https:// base URLs (W-017 — App Password over plaintext is unsafe).
 *   - Authenticates with Application Password via Basic auth.
 *   - Tries pretty-permalink URL form first (/wp-json/<route>), falls back to
 *     query-string form (?rest_route=/<route>) on 404 for permalink-disabled WP.
 *   - Returns parsed JSON when content-type matches; otherwise raw text.
 *   - Never logs the auth header.
 */
export class RestClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly userAgent: string;
  private readonly defaultTimeout: number;

  constructor(opts: RestClientOptions) {
    const u = new URL(opts.baseUrl);
    if (u.protocol !== "https:") {
      throw new WplabError(
        "REST_REQUIRES_HTTPS",
        "RestTarget only accepts https:// URLs — reconnect with the https:// form of the site URL. For a local dev site without TLS, use rolepod_wp_connect_local instead.",
        {
          baseUrl: opts.baseUrl,
        },
      );
    }
    // Strip trailing slash for clean joins
    this.baseUrl = `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, "")}`;
    this.authHeader =
      "Basic " +
      Buffer.from(
        `${opts.credential.username}:${opts.credential.appPassword}`,
      ).toString("base64");
    this.userAgent =
      opts.userAgent ??
      `rolepod-wplab/0.1 (+https://github.com/nuttaruj/rolepod-wplab)`;
    this.defaultTimeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async request(req: RestRequestInit): Promise<RestResponseRaw> {
    const path = req.path.startsWith("/") ? req.path : `/${req.path}`;
    const queryParams = req.query
      ? new URLSearchParams(stringifyQuery(req.query))
      : null;

    // Try pretty-permalink form: /wp-json/<path>
    const prettyUrl = `${this.baseUrl}/wp-json${path}${queryParams ? `?${queryParams}` : ""}`;
    let response = await this.send(prettyUrl, req);

    // Fall back to query-string form: /?rest_route=<path>
    if (response.status === 404 && this.looksLikePermalinkOff(response)) {
      log.debug("REST URL fallback engaged", { path });
      const params = new URLSearchParams();
      params.set("rest_route", path);
      if (queryParams) {
        for (const [k, v] of queryParams.entries()) params.append(k, v);
      }
      const fallbackUrl = `${this.baseUrl}/?${params}`;
      response = await this.send(fallbackUrl, req);
    }

    return response;
  }

  private async send(
    url: string,
    req: RestRequestInit,
  ): Promise<RestResponseRaw> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      req.timeoutMs ?? this.defaultTimeout,
    ).unref();

    try {
      const headers: Record<string, string> = {
        Authorization: this.authHeader,
        "User-Agent": this.userAgent,
        Accept: "application/json",
        ...req.headers,
      };

      let body: string | Uint8Array | undefined;
      if (req.body !== undefined) {
        if (typeof req.body === "string" || req.body instanceof Uint8Array) {
          body = req.body;
        } else {
          body = JSON.stringify(req.body);
          headers["Content-Type"] =
            headers["Content-Type"] ?? "application/json";
        }
      }

      const fetchInit: RequestInit = {
        method: req.method ?? "GET",
        headers,
        signal: controller.signal,
      };
      if (body !== undefined) fetchInit.body = body;

      const res = await fetch(url, fetchInit);
      const text = await res.text();
      const contentType = res.headers.get("content-type") ?? "";
      const parsed: unknown =
        contentType.includes("application/json") && text.length > 0
          ? safeJsonParse(text)
          : text;

      const headersOut: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headersOut[key] = value;
      });

      return { status: res.status, body: parsed, headers: headersOut };
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === "AbortError") {
        throw new WplabError(
          "REST_TIMEOUT",
          `REST request timed out after ${req.timeoutMs ?? this.defaultTimeout}ms`,
          {
            url: redactUrl(url),
          },
        );
      }
      throw new WplabError(
        "REST_NETWORK_ERROR",
        `REST request failed: ${e.message ?? "unknown"}`,
        {
          url: redactUrl(url),
        },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private looksLikePermalinkOff(response: RestResponseRaw): boolean {
    // WP returns 404 with HTML or a generic message when REST URL is /wp-json
    // but pretty permalinks are disabled. We use ?rest_route= as fallback.
    if (typeof response.body === "string") {
      return (
        /no route was found/i.test(response.body) ||
        /<!doctype html>/i.test(response.body)
      );
    }
    if (
      response.body &&
      typeof response.body === "object" &&
      "code" in response.body
    ) {
      return (response.body as { code: string }).code === "rest_no_route";
    }
    return true; // err on the side of trying the fallback when 404 + unknown shape
  }
}

function stringifyQuery(
  q: Record<string, string | number | boolean>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) out[k] = String(v);
  return out;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}
