import { acfAdapter } from "../../adapters/acf/read.js";
import {
  AcfReadInputSchema,
  AcfReadOutputSchema,
  type AcfReadInput,
  type AcfReadOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpAcfReadToolDef = {
  name: "rolepod_wp_acf_read",
  description:
    "Read ACF (Advanced Custom Fields) data. Scopes: field_groups, fields_in_group (requires group_key), post_meta (requires post_id). Works with both ACF free + Pro; Pro has fuller REST surface.",
  inputSchema: AcfReadInputSchema,
};

export async function wpAcfReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<AcfReadOutput> {
  const input: AcfReadInput = AcfReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const detected = await acfAdapter.detect(target);
  if (!detected) {
    return AcfReadOutputSchema.parse({
      scope: input.scope,
      detected: false,
      items: [],
    });
  }

  switch (input.scope) {
    case "field_groups": {
      const items = await acfAdapter.read.fieldGroups(target);
      return AcfReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        items,
      });
    }
    case "fields_in_group": {
      if (!input.group_key) {
        throw new WplabError(
          "ACF_READ_MISSING_GROUP_KEY",
          "scope=fields_in_group requires group_key arg",
          {},
        );
      }
      const items = await acfAdapter.read.fieldsInGroup(
        target,
        input.group_key,
      );
      return AcfReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        items,
      });
    }
    case "post_meta": {
      if (input.post_id === undefined) {
        throw new WplabError(
          "ACF_READ_MISSING_POST_ID",
          "scope=post_meta requires post_id arg",
          {},
        );
      }
      const meta = await acfAdapter.read.postMeta(target, input.post_id);
      return AcfReadOutputSchema.parse({
        scope: input.scope,
        detected: true,
        meta,
      });
    }
  }
}
