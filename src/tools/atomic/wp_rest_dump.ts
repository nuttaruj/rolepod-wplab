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
    'Enumerate the REST routes registered on the target (GET /wp-json index). Default returns the namespaces and a route count per namespace (~1 KB) — a plugin-heavy site has 300+ routes, ~50 KB as a table. Pass filter_namespace="wc/v3" for one namespace\'s path/methods table, or full=true for all of them.',
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
  const out: NonNullable<RestDumpOutput["routes"]> = [];
  const byNamespace: Record<string, number> = {};
  for (const [path, info] of Object.entries(routes)) {
    const ns = info.namespace ?? "";
    if (input.filter_namespace !== undefined && ns !== input.filter_namespace)
      continue;
    out.push({ path, namespace: ns, methods: info.methods ?? [] });
    byNamespace[ns] = (byNamespace[ns] ?? 0) + 1;
  }
  // Counts by default; the table only when asked for a namespace or for
  // everything. Measured on a real plugin-heavy site: 371 routes, ~56 KB
  // pretty-printed, against ~1 KB for the counts.
  const withRoutes = input.filter_namespace !== undefined || input.full;
  return RestDumpOutputSchema.parse({
    namespaces:
      input.filter_namespace !== undefined
        ? namespaces.filter((n) => n === input.filter_namespace)
        : namespaces,
    route_count: out.length,
    routes_by_namespace: byNamespace,
    ...(withRoutes ? { routes: out } : {}),
  });
}
