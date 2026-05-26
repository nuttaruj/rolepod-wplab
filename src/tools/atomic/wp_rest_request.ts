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
    "Generic authenticated REST passthrough. Useful when no dedicated tool covers a specific endpoint (e.g. plugin-published custom routes). Uses the same auth + URL form fallback as RestTarget.",
  inputSchema: RestRequestInputSchema,
};

export async function wpRestRequestHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<RestRequestOutput> {
  const input: RestRequestInput = RestRequestInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const req: Parameters<typeof target.rest>[0] = {
    method: input.method,
    path: input.path,
  };
  if (input.query !== undefined) req.query = input.query;
  if (input.body !== undefined) req.body = input.body;
  if (input.headers !== undefined) req.headers = input.headers;
  const res = await target.rest(req);
  return RestRequestOutputSchema.parse({
    status: res.status,
    body: res.body,
    headers: res.headers,
  });
}
