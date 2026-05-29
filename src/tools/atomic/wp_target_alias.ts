import { AliasStore } from "../../lib/targetAliases.js";
import { openAlias, forgetAliasMapping } from "../../lib/aliasResolver.js";
import {
  TargetAliasInputSchema,
  TargetAliasOutputSchema,
  type TargetAliasInput,
  type TargetAliasOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";
import { WplabError } from "../../util/errors.js";
import { canonicalizeSite } from "../../credentials/types.js";

export const wpTargetAliasToolDef = {
  name: "rolepod_wp_target_alias",
  description:
    'Manage persistent target aliases. Aliases let you reference a WordPress target by a friendly name (`@demo`) instead of the ephemeral `tgt_<hex>` id that expires after 10 min idle. Actions: set | list | rm | resolve. Once an alias is set, any other tool can accept `target_id: "@<alias>"` — the dispatcher resolves to a live session transparently and auto-reconnects on idle expiry.',
  inputSchema: TargetAliasInputSchema,
};

export async function wpTargetAliasHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<TargetAliasOutput> {
  const input: TargetAliasInput = TargetAliasInputSchema.parse(raw);
  const store = new AliasStore();

  switch (input.action) {
    case "set": {
      const credentialRef =
        input.credential_ref || canonicalizeSite(input.siteurl);
      const entry = await store.set({
        alias: input.alias,
        siteurl: input.siteurl,
        credential_ref: credentialRef,
      });
      forgetAliasMapping(input.alias);
      return TargetAliasOutputSchema.parse({
        action: "set",
        alias: entry.alias,
        siteurl: entry.siteurl,
        credential_ref: entry.credential_ref,
      });
    }

    case "list": {
      const list = await store.list();
      return TargetAliasOutputSchema.parse({
        action: "list",
        aliases: list,
      });
    }

    case "rm": {
      const removed = await store.remove(input.alias);
      if (!removed) {
        throw new WplabError(
          "ALIAS_NOT_FOUND",
          `target alias "${input.alias}" not configured.`,
          { alias: input.alias },
        );
      }
      forgetAliasMapping(input.alias);
      return TargetAliasOutputSchema.parse({
        action: "rm",
        alias: input.alias,
        removed: true,
      });
    }

    case "resolve": {
      const targetId = await openAlias({ registry, store }, input.alias);
      const entry = await store.get(input.alias);
      return TargetAliasOutputSchema.parse({
        action: "resolve",
        alias: input.alias,
        target_id: targetId,
        siteurl: entry?.siteurl,
        credential_ref: entry?.credential_ref,
      });
    }
  }
}
