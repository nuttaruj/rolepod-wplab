/**
 * Audit an `_elementor_data` tree for HTML widget overuse + suggest native
 * widget alternatives for common content patterns.
 *
 * Heuristic-based: looks at each HTML widget's content, identifies
 * recognisable patterns (single <h1>, single <p>, single <a>, lone counter
 * markup, etc.), and recommends the matching native widget.
 *
 * Recommendations come from the Phase 6 patterns catalog (see
 * skills/wp-edit-design/references/patterns.md).
 */
export interface AuditSuggestion {
  widgetId: string;
  reason: string;
  suggestedWidget?: string;
  suggestedPattern?: string;
  /**
   * How much visual/behavioural fidelity is at risk if this HTML widget is
   * blindly replaced by its native equivalent.
   *   - "low":  the widget carries custom CSS (colors/fonts/gradients) that a
   *             native widget CAN reproduce, but ONLY if those values are
   *             carried over into the widget's style controls. Drop them and
   *             the look drifts.
   *   - "high": the widget carries CSS animations or JavaScript behaviour that
   *             Elementor's free widget set has NO equivalent for. Converting
   *             without re-implementing these in custom CSS/Motion FX/custom
   *             code WILL lose the effect.
   * Absent → the widget is plain markup, conversion is loss-free.
   */
  fidelityRisk?: "low" | "high";
  /** Human-readable list of what a naive conversion would drop. */
  wouldLose?: string[];
}

export interface AuditResult {
  totalWidgets: number;
  htmlWidgets: number;
  htmlWidgetPct: number;
  widgetTypeCounts: Record<string, number>;
  suggestions: AuditSuggestion[];
  /**
   * Count of HTML widgets that carry custom CSS/JS the page's design depends
   * on. These are the widgets where a "just convert to native" pass silently
   * destroys the design — the Phase 8 failure mode.
   */
  lossyWidgets: number;
  /**
   * Present whenever `lossyWidgets > 0`. A short directive telling the agent
   * to extract the widget's styling/behaviour into the native widget's
   * controls (or custom CSS / Motion FX / custom code) BEFORE converting —
   * never convert blind.
   */
  guidance?: string;
}

/** Flags describing the custom styling/behaviour packed into an HTML widget. */
interface FidelityFlags {
  hasStyle: boolean;
  hasCustomFont: boolean;
  hasGradient: boolean;
  hasAnimation: boolean;
  hasScript: boolean;
}

/**
 * Scan a raw HTML widget body for the styling/behaviour that a native-widget
 * conversion would drop. Pure string heuristics — no DOM, no browser.
 */
function detectFidelity(html: string): FidelityFlags {
  return {
    // <style> block = the widget paints itself; inline style= attrs count too.
    hasStyle: /<style[\s>]/i.test(html) || /\sstyle\s*=\s*["']/i.test(html),
    hasCustomFont: /font-family\s*:/i.test(html),
    hasGradient: /(?:linear|radial|conic)-gradient\s*\(/i.test(html),
    hasAnimation:
      /@keyframes\b/i.test(html) ||
      /\banimation\s*:/i.test(html) ||
      /\btransition\s*:/i.test(html),
    // <script>, inline on*= handlers, or JS-effect data hooks (typer, scramble,
    // tilt, magnet, marquee, reveal, parallax). Elementor free has no equivalent.
    hasScript:
      /<script[\s>]/i.test(html) ||
      /\son[a-z]+\s*=\s*["']/i.test(html) ||
      /\bdata-(?:typer|scramble|tilt|magnet|marquee|reveal|parallax|count)\b/i.test(
        html,
      ),
  };
}

/** Turn fidelity flags into a "what you'd lose" list + a low/high risk grade. */
function gradeFidelity(
  f: FidelityFlags,
): { risk: "low" | "high"; wouldLose: string[] } | null {
  const wouldLose: string[] = [];
  if (f.hasStyle) wouldLose.push("inline CSS (colors / spacing / layout)");
  if (f.hasCustomFont)
    wouldLose.push("custom font-family (typography identity)");
  if (f.hasGradient) wouldLose.push("CSS gradients");
  if (f.hasAnimation) wouldLose.push("CSS animations / transitions");
  if (f.hasScript)
    wouldLose.push("JavaScript behaviour (no Elementor-free equivalent)");
  if (wouldLose.length === 0) return null;
  // Animation or JS = genuinely irreplaceable in free Elementor → high.
  const risk: "low" | "high" = f.hasAnimation || f.hasScript ? "high" : "low";
  return { risk, wouldLose };
}

/**
 * Walk a sections array (verbatim from `_elementor_data` JSON) and produce
 * an audit summary.
 */
export function auditElementorTree(
  sections: ReadonlyArray<Record<string, unknown>>,
): AuditResult {
  const counts: Record<string, number> = {};
  let total = 0;
  let htmlCount = 0;
  let lossyWidgets = 0;
  const suggestions: AuditSuggestion[] = [];

  function walk(node: Record<string, unknown>): void {
    const widgetType =
      typeof node["widgetType"] === "string"
        ? (node["widgetType"] as string)
        : "";
    if (widgetType !== "") {
      counts[widgetType] = (counts[widgetType] ?? 0) + 1;
      total++;
      if (widgetType === "html") {
        htmlCount++;
        const htmlContent = (
          node["settings"] as Record<string, unknown> | undefined
        )?.["html"];
        const html = typeof htmlContent === "string" ? htmlContent : "";
        const widgetId =
          typeof node["id"] === "string" ? (node["id"] as string) : "<no-id>";

        // Fidelity grade is independent of whether a structural conversion
        // match exists — a custom card carrying gradients/JS is "lossy" even
        // when we (correctly) don't suggest converting it.
        const fidelity = gradeFidelity(detectFidelity(html));
        if (fidelity) lossyWidgets++;

        const suggestion = analyzeHtmlBlock(html, widgetId);
        if (suggestion) {
          if (fidelity) {
            suggestion.fidelityRisk = fidelity.risk;
            suggestion.wouldLose = fidelity.wouldLose;
            suggestion.reason +=
              fidelity.risk === "high"
                ? " — WARNING: carries animation/JS with no Elementor-free equivalent; re-implement via custom CSS / Motion FX / custom code or the effect is lost"
                : " — carry its inline CSS (fonts/colors/gradients) into the native widget's style controls or the look will drift";
          }
          suggestions.push(suggestion);
        }
      }
    }
    const children = node["elements"];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") {
          walk(child as Record<string, unknown>);
        }
      }
    }
  }

  for (const section of sections) {
    if (section && typeof section === "object") {
      walk(section);
    }
  }

  const pct = total === 0 ? 0 : Math.round((htmlCount / total) * 1000) / 10;

  const result: AuditResult = {
    totalWidgets: total,
    htmlWidgets: htmlCount,
    htmlWidgetPct: pct,
    widgetTypeCounts: counts,
    suggestions,
    lossyWidgets,
  };
  if (lossyWidgets > 0) {
    result.guidance =
      `${lossyWidgets} HTML widget(s) carry custom CSS/JS the design depends on. ` +
      `Do NOT convert blind: first read each widget's <style>/<script>, then replicate ` +
      `typography, colors, gradients in the native widget's style controls (or Elementor ` +
      `global styles), and re-build any animation/JS via Motion FX or custom code. ` +
      `Verify against a screenshot taken AFTER scroll-reveal/JS has settled.`;
  }
  return result;
}

/**
 * Inspect a single HTML widget's content. If it looks like one of the
 * patterns Elementor has a native widget for, recommend the replacement.
 *
 * Conservative — only flags HIGH-CONFIDENCE matches. Custom layouts (cards,
 * grids, terminal blocks, marquees) are deliberately NOT flagged because
 * the HTML widget is the right choice for those.
 */
function analyzeHtmlBlock(
  html: string,
  widgetId: string,
): AuditSuggestion | null {
  const trimmed = html.trim();
  if (trimmed === "") return null;

  // Whole content = one heading tag
  const headingOnly = trimmed.match(/^<h([1-6])[^>]*>([\s\S]+?)<\/h\1>$/i);
  if (headingOnly) {
    return {
      widgetId,
      reason: `widget contains only a single <h${headingOnly[1]}> tag — replace with Elementor's native heading widget`,
      suggestedWidget: "heading",
    };
  }

  // Whole content = one paragraph
  const paraOnly = trimmed.match(/^<p[^>]*>([\s\S]+?)<\/p>$/i);
  if (paraOnly && !/<(?:h[1-6]|button|a\b|svg|img|table)/i.test(paraOnly[1]!)) {
    return {
      widgetId,
      reason:
        "widget contains only a single <p> — replace with Elementor's native text-editor widget",
      suggestedWidget: "text-editor",
    };
  }

  // Whole content = one anchor styled as button
  const anchorOnly = trimmed.match(
    /^<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>([\s\S]+?)<\/a>$/i,
  );
  if (anchorOnly) {
    return {
      widgetId,
      reason:
        "widget contains only a single button-styled anchor — replace with Elementor's native button widget",
      suggestedWidget: "button",
    };
  }

  // Looks like a list of FAQ details/summary pairs
  if (
    /<details\b[^>]*>[\s\S]*<summary\b/i.test(trimmed) &&
    (trimmed.match(/<details\b/gi)?.length ?? 0) >= 2
  ) {
    return {
      widgetId,
      reason:
        "widget contains <details>/<summary> FAQ markup — replace with the native accordion widget (pattern P-003)",
      suggestedWidget: "accordion",
      suggestedPattern: "P-003",
    };
  }

  // Single ".stat-num" or counter-style number — could be a counter widget
  if (
    /data-count\s*=/.test(trimmed) &&
    (trimmed.match(/data-count\s*=/g)?.length ?? 0) >= 1
  ) {
    return {
      widgetId,
      reason:
        "widget contains data-count counter markup — Elementor has a native counter widget (pattern P-004)",
      suggestedWidget: "counter",
      suggestedPattern: "P-004",
    };
  }

  // Looks like an icon-box card (icon + heading + paragraph)
  if (
    /<(?:svg|i)\b/i.test(trimmed) &&
    /<h[1-6]\b/i.test(trimmed) &&
    /<p\b/i.test(trimmed) &&
    trimmed.length < 1500
  ) {
    return {
      widgetId,
      reason:
        "widget contains icon + heading + paragraph — consider Elementor's icon-box widget for editable per-card content (pattern P-002)",
      suggestedWidget: "icon-box",
      suggestedPattern: "P-002",
    };
  }

  return null;
}
