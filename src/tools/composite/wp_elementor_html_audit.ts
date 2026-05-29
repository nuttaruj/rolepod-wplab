import { bridgeFor } from "../../companion/Bridge.js";
import { WplabError } from "../../util/errors.js";
import { auditElementorTree } from "../../lib/elementorHtmlAudit.js";
import {
  WpElementorHtmlAuditInputSchema,
  WpElementorHtmlAuditOutputSchema,
  type WpElementorHtmlAuditInput,
  type WpElementorHtmlAuditOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorHtmlAuditToolDef = {
  name: "rolepod_wp_elementor_html_audit",
  description:
    "Audit an Elementor page for HTML widget overuse AND conversion fidelity risk. Walks the `_elementor_data` tree, counts each widget type, computes HTML widget percentage, and inspects each HTML block for patterns with a clean native replacement (single <h1> → heading, <details>/<summary> → accordion, data-count → counter, icon + heading + paragraph → icon-box, etc). For each block it ALSO scans for custom CSS/JS the design depends on (inline <style>, font-family, gradients, @keyframes/animation, <script>/JS data-hooks) and grades fidelity_risk (low = reproducible via native style controls if carried over; high = animation/JS with no Elementor-free equivalent). Returns over_threshold:true when HTML widget % > threshold_pct (default 30), plus lossy_widgets count and a `guidance` directive. CRITICAL: never convert a widget with fidelity_risk to native without first replicating its styling/behaviour — that is the silent-design-loss trap. USE after every Elementor page build before publishing.",
  inputSchema: WpElementorHtmlAuditInputSchema,
};

export async function wpElementorHtmlAuditHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<WpElementorHtmlAuditOutput> {
  const input: WpElementorHtmlAuditInput =
    WpElementorHtmlAuditInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_HTML_AUDIT_UNSUPPORTED_TARGET",
      "elementor_html_audit currently requires a `rest` target.",
      { target_kind: target.kind },
    );
  }

  const bridge = await bridgeFor(target);
  const exportResult = await bridge.elementorTemplateExport(input.post_id);
  const sections = (exportResult["sections"] ?? []) as ReadonlyArray<
    Record<string, unknown>
  >;

  const audit = auditElementorTree(sections);

  return WpElementorHtmlAuditOutputSchema.parse({
    post_id: input.post_id,
    total_widgets: audit.totalWidgets,
    html_widgets: audit.htmlWidgets,
    html_widget_pct: audit.htmlWidgetPct,
    over_threshold: audit.htmlWidgetPct > input.threshold_pct,
    threshold_pct: input.threshold_pct,
    widget_type_counts: audit.widgetTypeCounts,
    suggestions: audit.suggestions.map((s) => ({
      widget_id: s.widgetId,
      reason: s.reason,
      ...(s.suggestedWidget !== undefined
        ? { suggested_widget: s.suggestedWidget }
        : {}),
      ...(s.suggestedPattern !== undefined
        ? { suggested_pattern: s.suggestedPattern }
        : {}),
      ...(s.fidelityRisk !== undefined
        ? { fidelity_risk: s.fidelityRisk }
        : {}),
      ...(s.wouldLose !== undefined ? { would_lose: s.wouldLose } : {}),
    })),
    lossy_widgets: audit.lossyWidgets,
    ...(audit.guidance !== undefined ? { guidance: audit.guidance } : {}),
  });
}
