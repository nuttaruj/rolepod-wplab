import { bridgeFor } from "../../companion/Bridge.js";
import {
  SkillWriteInputSchema,
  SkillWriteOutputSchema,
  type SkillWriteInput,
  type SkillWriteOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSkillWriteToolDef = {
  name: "rolepod_wp_skill_write",
  description:
    "Create or update a site-owned skill — a reusable playbook stored ON this WordPress install (build conventions, brand voice, schema quirks, fragile procedures). `title` becomes both the human label and the lookup slug (lowercased, dash-separated). `description` is the one-line trigger the agent reads to decide when to fire the skill. `content` is the SKILL.md body (instructions only — keep it tight). on_conflict: fail (default) | replace | rename. Recoverable via post revisions. Requires the rolepod-wp companion v2.13+.",
  inputSchema: SkillWriteInputSchema,
};

export async function wpSkillWriteHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<SkillWriteOutput> {
  const input: SkillWriteInput = SkillWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const result = await bridge.skillWrite({
    title: input.title,
    description: input.description,
    content: input.content,
    on_conflict: input.on_conflict,
    ...(input.enable_agentic !== undefined ? { enable_agentic: input.enable_agentic } : {}),
    ...(input.enable_prompt !== undefined ? { enable_prompt: input.enable_prompt } : {}),
  });
  return SkillWriteOutputSchema.parse(result);
}
