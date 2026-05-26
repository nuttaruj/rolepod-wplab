import { formsAdapter } from "../../adapters/forms/read.js";
import {
  FormsReadInputSchema,
  FormsReadOutputSchema,
  type FormsReadInput,
  type FormsReadOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpFormsReadToolDef = {
  name: "rolepod_wp_forms_read",
  description:
    "Read forms across Gravity Forms / Contact Form 7 / WPForms. Auto-detect by default. Scopes: list_forms, form_detail (needs form_id), list_entries (Gravity only in v1.1).",
  inputSchema: FormsReadInputSchema,
};

export async function wpFormsReadHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<FormsReadOutput> {
  const input: FormsReadInput = FormsReadInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const engine =
    input.engine === "auto"
      ? await formsAdapter.read.detectEngine(target)
      : input.engine;
  if (engine === "none") {
    return FormsReadOutputSchema.parse({
      scope: input.scope,
      engine_used: "none",
      detected: false,
    });
  }

  if (input.scope === "list_forms") {
    const items = await formsAdapter.read.listForms(
      target,
      engine,
      input.per_page,
    );
    return FormsReadOutputSchema.parse({
      scope: input.scope,
      engine_used: engine,
      detected: true,
      items,
    });
  }
  if (input.scope === "form_detail") {
    if (input.form_id === undefined) {
      throw new WplabError(
        "FORMS_READ_MISSING_FORM_ID",
        "scope=form_detail requires form_id",
        {},
      );
    }
    const form = await formsAdapter.read.getForm(target, engine, input.form_id);
    return FormsReadOutputSchema.parse({
      scope: input.scope,
      engine_used: engine,
      detected: true,
      form,
    });
  }
  // list_entries
  const items = await formsAdapter.read.listEntries(
    target,
    engine,
    input.form_id,
    input.per_page,
  );
  return FormsReadOutputSchema.parse({
    scope: input.scope,
    engine_used: engine,
    detected: true,
    items,
  });
}
