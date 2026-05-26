import { recordChange } from "../../companion/ledger.js";
import { flushObjectCache } from "../../companion/cacheFlush.js";
import {
  RestRequestInputSchema,
  RestRequestOutputSchema,
  type RestRequestInput,
  type RestRequestOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRestRequestToolDef = {
  name: "rolepod_wp_rest_request",
  description:
    "Generic authenticated REST passthrough. Useful when no dedicated tool covers a specific endpoint (e.g. plugin-published custom routes). Uses the same auth + URL form fallback as RestTarget. Writes to /wp/v2/global-styles/<id> are auto-ledgered + auto-cache-flushed so they integrate with the Change Ledger and the Site Editor sees the new state on next reload.",
  inputSchema: RestRequestInputSchema,
};

export async function wpRestRequestHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<RestRequestOutput> {
  const input: RestRequestInput = RestRequestInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  // Detect global-styles write. WP exposes one wp_global_styles post per theme;
  // its REST path is /wp/v2/global-styles/<id> with method POST|PUT|PATCH for
  // updates. Capture before-state via a GET first so the Change Ledger can
  // restore the prior `styles` / `settings` payload on toggle.
  const isGlobalStylesWrite =
    /^\/wp\/v2\/global-styles\/\d+(\/|$)/.test(input.path) &&
    (input.method === "POST" || input.method === "PUT" || input.method === "PATCH");

  let beforeState: Record<string, unknown> | null = null;
  if (isGlobalStylesWrite) {
    try {
      const pre = await target.rest({
        method: "GET",
        path: `${input.path}${input.path.includes("?") ? "&" : "?"}context=edit`,
      });
      if (pre.status >= 200 && pre.status < 300) {
        const b = (pre.body ?? {}) as Record<string, unknown>;
        beforeState = {
          id: b["id"] ?? null,
          styles: b["styles"] ?? null,
          settings: b["settings"] ?? null,
        };
      }
    } catch {
      /* swallow — write proceeds without revert capability */
    }
  }

  const req: Parameters<typeof target.rest>[0] = {
    method: input.method,
    path: input.path,
  };
  if (input.query !== undefined) req.query = input.query;
  if (input.body !== undefined) req.body = input.body;
  if (input.headers !== undefined) req.headers = input.headers;
  const res = await target.rest(req);

  if (isGlobalStylesWrite && res.status >= 200 && res.status < 300) {
    const record: Parameters<typeof recordChange>[1] = {
      category: "layout",
      subcategory: "global_styles",
      targetDescriptor: `${input.method} ${input.path}`,
      beforeState: beforeState ?? null,
      afterState: input.body ?? null,
      reversible: beforeState !== null,
      sourceTool: "wp_rest_request",
    };
    if (beforeState === null) {
      record.notes = "no before-state captured — revert may be partial";
    }
    await recordChange(target, record);
    await flushObjectCache(target);
  }

  return RestRequestOutputSchema.parse({
    status: res.status,
    body: res.body,
    headers: res.headers,
  });
}
