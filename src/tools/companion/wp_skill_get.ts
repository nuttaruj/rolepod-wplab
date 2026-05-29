import { bridgeFor } from "../../companion/Bridge.js";
import {
  SkillGetInputSchema,
  SkillGetOutputSchema,
  type SkillGetInput,
  type SkillGetOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSkillGetToolDef = {
  name: "rolepod_wp_skill_get",
  description:
    "Load one site-owned skill's full SKILL.md body by slug. Call this after rolepod_wp_skill_catalog once a skill's description matches the task, to pull its instructions on demand (progressive disclosure — bodies are not in the catalog). Returns found:false when no skill owns the slug. Requires the rolepod-wp companion v2.13+.",
  inputSchema: SkillGetInputSchema,
};

export async function wpSkillGetHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<SkillGetOutput> {
  const input: SkillGetInput = SkillGetInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const skill = await bridge.skillGet(input.slug);
  if (skill === null) {
    return SkillGetOutputSchema.parse({ found: false });
  }
  return SkillGetOutputSchema.parse({ found: true, ...skill });
}
