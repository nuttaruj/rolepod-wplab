import { bridgeFor } from "../../companion/Bridge.js";
import {
  SkillEditInputSchema,
  SkillEditOutputSchema,
  type SkillEditInput,
  type SkillEditOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpSkillEditToolDef = {
  name: "rolepod_wp_skill_edit",
  description:
    "Patch specific fields of an existing site-owned skill by slug — any of description / content / enable_agentic / enable_prompt. Use this for iterative refinement after the user tries a skill (change only what was wrong, don't rewrite the whole body). Recoverable via post revisions. Requires the rolepod-wp companion v2.13+.",
  inputSchema: SkillEditInputSchema,
};

export async function wpSkillEditHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<SkillEditOutput> {
  const input: SkillEditInput = SkillEditInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const bridge = await bridgeFor(target);
  const patch: {
    description?: string;
    content?: string;
    enable_agentic?: boolean;
    enable_prompt?: boolean;
  } = {};
  if (input.description !== undefined) patch.description = input.description;
  if (input.content !== undefined) patch.content = input.content;
  if (input.enable_agentic !== undefined) patch.enable_agentic = input.enable_agentic;
  if (input.enable_prompt !== undefined) patch.enable_prompt = input.enable_prompt;

  const result = await bridge.skillEdit(input.slug, patch);
  return SkillEditOutputSchema.parse(result);
}
