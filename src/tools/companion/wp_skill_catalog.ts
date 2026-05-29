import { bridgeFor } from "../../companion/Bridge.js";
import {
  SkillCatalogInputSchema,
  SkillCatalogOutputSchema,
  type SkillCatalogInput,
  type SkillCatalogOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSkillCatalogToolDef = {
  name: "rolepod_wp_skill_catalog",
  description:
    "List this site's own agent skills — slug + one-line trigger description only, no bodies. Skills are reusable playbooks (build conventions, brand voice, schema quirks) stored ON this WordPress install, so they travel with the site. When a skill's description matches the user's request, call rolepod_wp_skill_get with its slug to load the full instructions BEFORE starting work. Requires the rolepod-wp companion v2.13+ (capability `skills`).",
  inputSchema: SkillCatalogInputSchema,
};

export async function wpSkillCatalogHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<SkillCatalogOutput> {
  const input: SkillCatalogInput = SkillCatalogInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const skills = await bridge.skillCatalog();
  return SkillCatalogOutputSchema.parse({ skills });
}
