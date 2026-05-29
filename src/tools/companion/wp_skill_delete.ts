import { bridgeFor } from "../../companion/Bridge.js";
import {
  SkillDeleteInputSchema,
  SkillDeleteOutputSchema,
  type SkillDeleteInput,
  type SkillDeleteOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSkillDeleteToolDef = {
  name: "rolepod_wp_skill_delete",
  description:
    "Remove a site-owned skill by slug. The skill is moved to the WordPress trash (recoverable), never permanently destroyed. Requires the rolepod-wp companion v2.13+.",
  inputSchema: SkillDeleteInputSchema,
};

export async function wpSkillDeleteHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<SkillDeleteOutput> {
  const input: SkillDeleteInput = SkillDeleteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const result = await bridge.skillDelete(input.slug);
  return SkillDeleteOutputSchema.parse(result);
}
