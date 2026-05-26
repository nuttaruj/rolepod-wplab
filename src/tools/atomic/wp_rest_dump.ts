import {
  RestDumpInputSchema,
  RestDumpOutputSchema,
  type RestDumpInput,
  type RestDumpOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpRestDumpToolDef = {
  name: "rolepod_wp_rest_dump",
  description:
    'Enumerate every registered REST route on the target (GET /wp-json index). Returns namespaces + path/methods table. Optional filter_namespace="wc/v3" narrows to a single plugin namespace.',
  inputSchema: RestDumpInputSchema,
};

export async function wpRestDumpHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<RestDumpOutput> {
  const input: RestDumpInput = RestDumpInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const res = await target.rest({ method: "GET", path: "/" });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "REST_DUMP_FAILED",
      `index returned HTTP ${res.status}`,
      { status: res.status },
    );
  }
  const body = (res.body ?? {}) as {
    namespaces?: string[];
    routes?: Record<string, { namespace?: string; methods?: string[] }>;
  };
  const namespaces = body.namespaces ?? [];
  const routes = body.routes ?? {};
  const out: RestDumpOutput["routes"] = [];
  for (const [path, info] of Object.entries(routes)) {
    const ns = info.namespace ?? "";
    if (input.filter_namespace !== undefined && ns !== input.filter_namespace)
      continue;
    out.push({ path, namespace: ns, methods: info.methods ?? [] });
  }
  return RestDumpOutputSchema.parse({
    namespaces:
      input.filter_namespace !== undefined
        ? namespaces.filter((n) => n === input.filter_namespace)
        : namespaces,
    route_count: out.length,
    routes: out,
  });
}
