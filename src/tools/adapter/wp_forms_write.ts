import { formsAdapter } from "../../adapters/forms/read.js";
import { formsWrite } from "../../adapters/forms/write.js";
import { recordChange } from "../../companion/ledger.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  FormsWriteInputSchema,
  FormsWriteOutputSchema,
  type FormsWriteInput,
  type FormsWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFormsWriteToolDef = {
  name: "rolepod_wp_forms_write",
  description:
    "Forms entry write ops: delete_entry, mark_spam, unmark_spam. Gravity Forms only in v1.1. Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: FormsWriteInputSchema,
};

export async function wpFormsWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<FormsWriteOutput> {
  const input: FormsWriteInput = FormsWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "forms_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  const detectedEngine = await formsAdapter.read.detectEngine(target);
  if (detectedEngine === "none") {
    throw new WplabError(
      "ADAPTER_NOT_DETECTED",
      "no form plugin active on target",
      { targetId: input.target_id },
    );
  }
  const op =
    input.op === "delete_entry"
      ? formsWrite.deleteEntry
      : input.op === "mark_spam"
        ? formsWrite.markSpam
        : formsWrite.unmarkSpam;
  const r = await op(target, input.engine, input.entry_id);

  // Entry moderation is not reversible through the ledger — deleting an entry
  // is permanent, and a spam-status flip is a one-liner the user can redo by
  // hand. Record for visibility.
  await recordChange(target, {
    category: "post",
    subcategory: `form-entry:${input.op}`,
    targetDescriptor: `${input.engine} entry ${input.entry_id} — ${input.op}`,
    afterState: { op: input.op, entry_id: input.entry_id },
    reversible: false,
    notes:
      input.op === "delete_entry"
        ? `Entry ${input.entry_id} was deleted — this cannot be undone from the ledger.`
        : `Spam status changed. To reverse, run the opposite op (mark_spam ⇄ unmark_spam) on entry ${input.entry_id}.`,
    sourceTool: "rolepod_wp_forms_write",
  });

  return FormsWriteOutputSchema.parse({
    op: input.op,
    entry_id: input.entry_id,
    source: r.source,
  });
}
