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
}

export interface AuditResult {
  totalWidgets: number;
  htmlWidgets: number;
  htmlWidgetPct: number;
  widgetTypeCounts: Record<string, number>;
  suggestions: AuditSuggestion[];
}

/**
 * Walk a sections array (verbatim from `_elementor_data` JSON) and produce
 * an audit summary.
 */
export function auditElementorTree(sections: ReadonlyArray<Record<string, unknown>>): AuditResult {
  const counts: Record<string, number> = {};
  let total = 0;
  let htmlCount = 0;
  const suggestions: AuditSuggestion[] = [];

  function walk(node: Record<string, unknown>): void {
    const widgetType =
      typeof node["widgetType"] === "string" ? (node["widgetType"] as string) : "";
    if (widgetType !== "") {
      counts[widgetType] = (counts[widgetType] ?? 0) + 1;
      total++;
      if (widgetType === "html") {
        htmlCount++;
        const htmlContent =
          (node["settings"] as Record<string, unknown> | undefined)?.["html"];
        const widgetId =
          typeof node["id"] === "string" ? (node["id"] as string) : "<no-id>";
        const suggestion = analyzeHtmlBlock(
          typeof htmlContent === "string" ? htmlContent : "",
          widgetId,
        );
        if (suggestion) {
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

  return {
    totalWidgets: total,
    htmlWidgets: htmlCount,
    htmlWidgetPct: pct,
    widgetTypeCounts: counts,
    suggestions,
  };
}

/**
 * Inspect a single HTML widget's content. If it looks like one of the
 * patterns Elementor has a native widget for, recommend the replacement.
 *
 * Conservative — only flags HIGH-CONFIDENCE matches. Custom layouts (cards,
 * grids, terminal blocks, marquees) are deliberately NOT flagged because
 * the HTML widget is the right choice for those.
 */
function analyzeHtmlBlock(html: string, widgetId: string): AuditSuggestion | null {
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
      reason: "widget contains only a single <p> — replace with Elementor's native text-editor widget",
      suggestedWidget: "text-editor",
    };
  }

  // Whole content = one anchor styled as button
  const anchorOnly = trimmed.match(/^<a\b[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*>([\s\S]+?)<\/a>$/i);
  if (anchorOnly) {
    return {
      widgetId,
      reason: "widget contains only a single button-styled anchor — replace with Elementor's native button widget",
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
      reason: "widget contains <details>/<summary> FAQ markup — replace with the native accordion widget (pattern P-003)",
      suggestedWidget: "accordion",
      suggestedPattern: "P-003",
    };
  }

  // Single ".stat-num" or counter-style number — could be a counter widget
  if (/data-count\s*=/.test(trimmed) && (trimmed.match(/data-count\s*=/g)?.length ?? 0) >= 1) {
    return {
      widgetId,
      reason: "widget contains data-count counter markup — Elementor has a native counter widget (pattern P-004)",
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
      reason: "widget contains icon + heading + paragraph — consider Elementor's icon-box widget for editable per-card content (pattern P-002)",
      suggestedWidget: "icon-box",
      suggestedPattern: "P-002",
    };
  }

  return null;
}
