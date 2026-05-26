import { MemoryStore } from "../../memory/MemoryStore.js";
import { canonicalizeSite } from "../../credentials/types.js";
import {
  MemoryRecallInputSchema,
  MemoryRecallOutputSchema,
  type MemoryRecallInput,
  type MemoryRecallOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpMemoryRecallToolDef = {
  name: "rolepod_wp_memory_recall",
  description:
    "Recall per-site notes / conventions / runbooks (W-028). Site is derived from target.siteurl. Optional query substring-filters note bodies (case-insensitive). Local-only, never phones home.",
  inputSchema: MemoryRecallInputSchema,
};

export async function wpMemoryRecallHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<MemoryRecallOutput> {
  const input: MemoryRecallInput = MemoryRecallInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const slug = canonicalizeSite(target.siteurl);
  const recallOpts: { query?: string; kind?: MemoryRecallInput["kind"] } = {
    kind: input.kind,
  };
  if (input.query !== undefined) recallOpts.query = input.query;
  const result = await MemoryStore.recall(slug, recallOpts);
  return MemoryRecallOutputSchema.parse(result);
}
