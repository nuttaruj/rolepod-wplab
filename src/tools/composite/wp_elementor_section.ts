import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import {
  readElementorData,
  writeElementorData,
  type ElementorSection,
} from "../../lib/elementorData.js";
import {
  WpElementorSectionInputSchema,
  WpElementorSectionOutputSchema,
  type WpElementorSectionInput,
  type WpElementorSectionOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorSectionToolDef = {
  name: "rolepod_wp_elementor_section",
  description:
    "Surgically edit ONE top-level Elementor section without rewriting the whole page. action: get | replace | insert | delete. Match a section by `section_id` (Elementor element id) or `match_class` (a token in its `_css_classes`). replace/delete require a match; insert places `section` at `position` (before/after the match, or start/end of the page). Mutations auto-backup `_elementor_data` and auto-flush the Elementor CSS cache. Requires the rolepod-wp companion (or a shell target). Production target needs confirm=true for mutations.",
  inputSchema: WpElementorSectionInputSchema,
};

function classesOf(s: ElementorSection): string {
  const c = s.settings?._css_classes;
  return typeof c === "string" ? c : "";
}

/** Indices of top-level sections matching section_id or match_class. Exported for tests. */
export function matchSectionIndices(
  sections: ElementorSection[],
  sectionId: string | undefined,
  matchClass: string | undefined,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    if (sectionId !== undefined && s.id === sectionId) out.push(i);
    else if (
      matchClass !== undefined &&
      classesOf(s).split(/\s+/).includes(matchClass)
    )
      out.push(i);
  }
  return out;
}

export async function wpElementorSectionHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpElementorSectionOutput> {
  const input: WpElementorSectionInput =
    WpElementorSectionInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const isMutation = input.action !== "get";

  if (isMutation) {
    const matched = prodGuard.matches(target.siteurl);
    if (matched.matched && !input.confirm) {
      throw new WplabError(
        "PRODUCTION_BLOCKED",
        `elementor_section ${input.action} on a prod target needs confirm=true`,
        { siteurl: target.siteurl, matchedPattern: matched.pattern },
      );
    }
  }

  if (input.section_id === undefined && input.match_class === undefined) {
    // insert at start/end is the only matchless-legal case.
    const matchless =
      input.action === "insert" &&
      (input.position === "start" || input.position === "end");
    if (!matchless) {
      throw new WplabError(
        "ELEMENTOR_SECTION_NO_SELECTOR",
        "provide section_id or match_class (insert with position start/end is the only exception)",
        { action: input.action },
      );
    }
  }

  const sections = await readElementorData(target, input.post_id);
  const idxs = matchSectionIndices(
    sections,
    input.section_id,
    input.match_class,
  );
  const matchedIds = idxs.map((i) => sections[i]!.id ?? "<no-id>");

  // ---- get: read-only ----
  if (input.action === "get") {
    return WpElementorSectionOutputSchema.parse({
      post_id: input.post_id,
      action: "get",
      matched: idxs.length,
      matched_ids: matchedIds,
      total_sections: sections.length,
      sections: idxs.map((i) => sections[i]),
    });
  }

  // ---- delete ----
  if (input.action === "delete") {
    if (idxs.length === 0) {
      throw new WplabError(
        "ELEMENTOR_SECTION_NOT_FOUND",
        "no section matched",
        {
          section_id: input.section_id,
          match_class: input.match_class,
        },
      );
    }
    const next = sections.filter((_, i) => !idxs.includes(i));
    const res = await writeElementorData(target, input.post_id, next);
    return WpElementorSectionOutputSchema.parse({
      post_id: input.post_id,
      action: "delete",
      matched: idxs.length,
      matched_ids: matchedIds,
      total_sections: next.length,
      bytes_written: res.bytesWritten,
      backup_path: res.backupPath,
      flushed: true,
    });
  }

  // replace / insert both need a section object.
  if (input.section === undefined) {
    throw new WplabError(
      "ELEMENTOR_SECTION_PAYLOAD_REQUIRED",
      `action ${input.action} requires a \`section\` object`,
      {},
    );
  }
  const newSection = input.section as ElementorSection;

  // ---- replace ----
  if (input.action === "replace") {
    if (idxs.length !== 1) {
      throw new WplabError(
        "ELEMENTOR_SECTION_AMBIGUOUS",
        `replace needs exactly 1 match, got ${idxs.length}`,
        { matched_ids: matchedIds },
      );
    }
    const next = [...sections];
    next[idxs[0]!] = newSection;
    const res = await writeElementorData(target, input.post_id, next);
    return WpElementorSectionOutputSchema.parse({
      post_id: input.post_id,
      action: "replace",
      matched: 1,
      matched_ids: matchedIds,
      total_sections: next.length,
      bytes_written: res.bytesWritten,
      backup_path: res.backupPath,
      flushed: true,
    });
  }

  // ---- insert ----
  const next = [...sections];
  if (input.position === "start") {
    next.unshift(newSection);
  } else if (input.position === "end") {
    next.push(newSection);
  } else {
    if (idxs.length === 0) {
      throw new WplabError(
        "ELEMENTOR_SECTION_NOT_FOUND",
        `insert ${input.position} needs a matched anchor section`,
        { section_id: input.section_id, match_class: input.match_class },
      );
    }
    const anchor = idxs[0]!;
    next.splice(
      input.position === "before" ? anchor : anchor + 1,
      0,
      newSection,
    );
  }
  const res = await writeElementorData(target, input.post_id, next);
  return WpElementorSectionOutputSchema.parse({
    post_id: input.post_id,
    action: "insert",
    matched: idxs.length,
    matched_ids: matchedIds,
    total_sections: next.length,
    bytes_written: res.bytesWritten,
    backup_path: res.backupPath,
    flushed: true,
  });
}
