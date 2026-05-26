import { bridgeFor } from "../../companion/Bridge.js";
import {
  IntrospectInputSchema,
  IntrospectOutputSchema,
  type IntrospectInput,
  type IntrospectOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpIntrospectToolDef = {
  name: "rolepod_wp_introspect",
  description:
    "Snapshot WordPress runtime context via the companion endpoint. Scopes: hooks (active actions/filters), transients (names + sizes), options_full (all wp_options rows), request_state (current request + WP state flags). include_values opt-in for transients/options on non-prod targets only.",
  inputSchema: IntrospectInputSchema,
};

export async function wpIntrospectHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<IntrospectOutput> {
  const input: IntrospectInput = IntrospectInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const report = await bridge.introspect(input.scope, {
    includeValues: input.include_values,
  });
  return IntrospectOutputSchema.parse({ scope: input.scope, report });
}
