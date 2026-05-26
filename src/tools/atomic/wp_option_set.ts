import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  OptionSetInputSchema,
  OptionSetOutputSchema,
  type OptionSetInput,
  type OptionSetOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpOptionSetToolDef = {
  name: "rolepod_wp_option_set",
  description:
    "Write a WordPress option. Routes via wp-cli when shell access available; falls back to REST /wp/v2/settings for the small allow-list WP exposes there. Production guard fires unless confirm=true.",
  inputSchema: OptionSetInputSchema,
};

export async function wpOptionSetHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<OptionSetOutput> {
  const input: OptionSetInput = OptionSetInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      `option_set blocked on production-matched target — pass confirm=true to proceed`,
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  // Snapshot before-state for the ledger.
  let beforeValue: unknown = null;
  try {
    if (
      target.kind === "local" ||
      target.kind === "ssh" ||
      target.kind === "docker"
    ) {
      const r = await target.wpCli(["option", "get", input.name, "--format=json"]);
      if (r.exitCode === 0) {
        try {
          beforeValue = JSON.parse(r.stdout.trim());
        } catch {
          beforeValue = r.stdout.trim();
        }
      }
    } else {
      const r = await target.rest({ method: "GET", path: "/wp/v2/settings" });
      if (r.status >= 200 && r.status < 300) {
        beforeValue = ((r.body ?? {}) as Record<string, unknown>)[input.name] ?? null;
      }
    }
  } catch {
    /* swallow */
  }

  // Shell-capable targets → wp-cli option update
  if (
    target.kind === "local" ||
    target.kind === "ssh" ||
    target.kind === "docker"
  ) {
    const value =
      typeof input.value === "string"
        ? input.value
        : JSON.stringify(input.value);
    const args = ["option", "update", input.name, value, "--format=json"];
    const result = await target.wpCli(args, { allowDestructive: true });
    if (result.exitCode !== 0) {
      throw new WplabError(
        "OPTION_SET_FAILED",
        `wp option update exit ${result.exitCode}`,
        {
          stderr: result.stderr.slice(0, 200),
          name: input.name,
        },
      );
    }
    // wp-cli prints "Success: Updated 'opt' option." or "Success: Value passed for 'opt' is unchanged."
    const changed = /Updated/i.test(result.stdout);
    if (changed) {
      await recordChange(target, {
        category: "option",
        subcategory: input.name,
        targetDescriptor: `option ${input.name} (via wp-cli)`,
        beforeState: { value: beforeValue },
        afterState: { value: input.value },
        reversible: true,
        sourceTool: "wp_option_set",
      });
    }
    return OptionSetOutputSchema.parse({
      name: input.name,
      changed,
      source: "wp_cli",
    });
  }

  // RestTarget → /wp/v2/settings (small allow-list)
  const res = await target.rest({
    method: "POST",
    path: "/wp/v2/settings",
    body: { [input.name]: input.value },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "OPTION_SET_FAILED",
      `REST settings returned HTTP ${res.status} — option may require wp-cli (install companion v0.2 for shared-hosting wp-cli proxy)`,
      { status: res.status, name: input.name },
    );
  }
  await recordChange(target, {
    category: "option",
    subcategory: input.name,
    targetDescriptor: `option ${input.name} (via rest /wp/v2/settings)`,
    beforeState: { value: beforeValue },
    afterState: { value: input.value },
    reversible: true,
    sourceTool: "wp_option_set",
  });
  return OptionSetOutputSchema.parse({
    name: input.name,
    changed: true,
    source: "rest_settings",
  });
}
