import { wpmlAdapter } from "../../adapters/wpml/read.js";
import { wpmlWrite } from "../../adapters/wpml/write.js";
import { ProdGuard } from "../../safety/ProdGuard.js";
import {
  WpmlWriteInputSchema,
  WpmlWriteOutputSchema,
  type WpmlWriteInput,
  type WpmlWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpWpmlWriteToolDef = {
  name: "rolepod_wp_wpml_write",
  description:
    "WPML write ops: set_post_language (lang_code), link_translations (translations map), duplicate_for_translation (target_language). Requires allow_destructive=true; production guard fires unless confirm=true.",
  inputSchema: WpmlWriteInputSchema,
};

export async function wpWpmlWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpmlWriteOutput> {
  const input: WpmlWriteInput = WpmlWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "wpml_write on prod target needs confirm=true",
      {
        siteurl: target.siteurl,
        matchedPattern: matched.pattern,
      },
    );
  }
  if (!(await wpmlAdapter.detect(target))) {
    throw new WplabError("ADAPTER_NOT_DETECTED", "WPML not active on target", {
      targetId: input.target_id,
    });
  }

  if (input.op === "set_post_language") {
    if (input.post_id === undefined || input.language_code === undefined) {
      throw new WplabError(
        "WPML_WRITE_BAD_INPUT",
        "set_post_language requires post_id + language_code",
        {},
      );
    }
    const r = await wpmlWrite.setPostLanguage(
      target,
      input.post_id,
      input.language_code,
    );
    return WpmlWriteOutputSchema.parse({
      op: input.op,
      source: r.source,
      result: { post_id: input.post_id, language_code: input.language_code },
    });
  }

  if (input.op === "link_translations") {
    if (
      input.original_post_id === undefined ||
      input.translations === undefined
    ) {
      throw new WplabError(
        "WPML_WRITE_BAD_INPUT",
        "link_translations requires original_post_id + translations map",
        {},
      );
    }
    const r = await wpmlWrite.linkTranslations(
      target,
      input.original_post_id,
      input.translations,
    );
    return WpmlWriteOutputSchema.parse({
      op: input.op,
      source: r.source,
      result: { linked_count: r.linked_count },
    });
  }

  if (input.post_id === undefined || input.target_language === undefined) {
    throw new WplabError(
      "WPML_WRITE_BAD_INPUT",
      "duplicate_for_translation requires post_id + target_language",
      {},
    );
  }
  const r = await wpmlWrite.duplicateForTranslation(
    target,
    input.post_id,
    input.target_language,
  );
  return WpmlWriteOutputSchema.parse({
    op: input.op,
    source: r.source,
    result: { new_post_id: r.new_post_id },
  });
}
