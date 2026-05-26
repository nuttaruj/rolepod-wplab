import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RestClient } from "../../src/runtime/restClient.js";
import { WplabError } from "../../src/util/errors.js";

const CRED = {
  site: "example.com",
  username: "admin",
  appPassword: "xxxx yyyy zzzz",
  addedAt: "2026-05-25T00:00:00Z",
};

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function htmlResponse(status: number, html: string): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html" },
  });
}

describe("RestClient", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("refuses non-https base URL", () => {
    expect(
      () => new RestClient({ baseUrl: "http://example.com", credential: CRED }),
    ).toThrow(WplabError);
  });

  it("strips trailing slash from base URL", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com/",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true }));
    await client.request({ path: "/wp/v2/types" });
    expect(fetchSpy.mock.calls[0]![0]).toBe(
      "https://example.com/wp-json/wp/v2/types",
    );
  });

  it("attaches Basic Authorization header with App Password", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, {}));
    await client.request({ path: "/wp/v2/users/me" });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    const expected =
      "Basic " + Buffer.from("admin:xxxx yyyy zzzz").toString("base64");
    expect(headers["Authorization"]).toBe(expected);
  });

  it("parses JSON response body when content-type is JSON", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, { id: 7, name: "post" }));
    const res = await client.request({ path: "/wp/v2/posts/7" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 7, name: "post" });
  });

  it("returns raw text when content-type is not JSON", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(
      new Response("plain text", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );
    const res = await client.request({ path: "/wp/v2/raw" });
    expect(res.body).toBe("plain text");
  });

  it("falls back to ?rest_route= form on 404 with rest_no_route body", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(404, { code: "rest_no_route", message: "No route" }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const res = await client.request({ path: "/wplab/v1/handshake" });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls).toHaveLength(2);
    expect(fetchSpy.mock.calls[1]![0]).toContain(
      "rest_route=%2Fwplab%2Fv1%2Fhandshake",
    );
  });

  it("falls back to ?rest_route= form on 404 with HTML body", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy
      .mockResolvedValueOnce(
        htmlResponse(404, "<!DOCTYPE html><html>not found</html>"),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const res = await client.request({ path: "/wp/v2/types" });
    expect(res.status).toBe(200);
    expect(fetchSpy.mock.calls).toHaveLength(2);
  });

  it("does NOT fall back when first response is 200", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true }));
    await client.request({ path: "/wp/v2/types" });
    expect(fetchSpy.mock.calls).toHaveLength(1);
  });

  it("serializes POST body as JSON when object", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(201, { id: 99 }));
    await client.request({
      method: "POST",
      path: "/wp/v2/posts",
      body: { title: "hi" },
    });
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ title: "hi" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("throws REST_TIMEOUT on abort", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          (init?.signal as AbortSignal | undefined)?.addEventListener(
            "abort",
            () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            },
          );
        }),
    );
    try {
      await client.request({ path: "/wp/v2/types", timeoutMs: 20 });
      throw new Error("should have timed out");
    } catch (err) {
      expect(err).toMatchObject({ code: "REST_TIMEOUT" });
    }
  });

  it("redacts auth in network-error context (no password leakage)", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockRejectedValue(new Error("connection reset"));
    try {
      await client.request({ path: "/wp/v2/types" });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as WplabError;
      const json = JSON.stringify(e.toJSON());
      expect(json).not.toContain("xxxx yyyy zzzz");
      expect(json).not.toContain("Basic ");
    }
  });

  it("encodes query parameters", async () => {
    const client = new RestClient({
      baseUrl: "https://example.com",
      credential: CRED,
    });
    fetchSpy.mockResolvedValue(jsonResponse(200, []));
    await client.request({
      path: "/wp/v2/posts",
      query: { per_page: 5, status: "publish" },
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("per_page=5");
    expect(url).toContain("status=publish");
  });
});
