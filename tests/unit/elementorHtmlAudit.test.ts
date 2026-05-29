import { describe, it, expect } from "vitest";
import { auditElementorTree } from "../../src/lib/elementorHtmlAudit.js";

function makeSection(children: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: "sec1",
    elType: "section",
    elements: [
      {
        id: "col1",
        elType: "column",
        elements: children,
      },
    ],
  };
}

function widget(id: string, widgetType: string, settings: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, elType: "widget", widgetType, settings };
}

describe("auditElementorTree", () => {
  it("counts zero widgets on empty input", () => {
    const r = auditElementorTree([]);
    expect(r.totalWidgets).toBe(0);
    expect(r.htmlWidgets).toBe(0);
    expect(r.htmlWidgetPct).toBe(0);
  });

  it("counts native widgets without flagging them", () => {
    const sections = [
      makeSection([
        widget("a", "heading", { title: "X" }),
        widget("b", "text-editor", { editor: "<p>...</p>" }),
        widget("c", "counter", { ending_number: 10 }),
        widget("d", "accordion", { tabs: [] }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.totalWidgets).toBe(4);
    expect(r.htmlWidgets).toBe(0);
    expect(r.htmlWidgetPct).toBe(0);
    expect(r.suggestions).toHaveLength(0);
  });

  it("flags a single-heading HTML widget", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", { html: "<h1>We build websites</h1>" }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.htmlWidgets).toBe(1);
    expect(r.htmlWidgetPct).toBe(100);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.suggestedWidget).toBe("heading");
  });

  it("flags a single-paragraph HTML widget", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", { html: "<p>Body text only.</p>" }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("text-editor");
  });

  it("does NOT flag a paragraph containing a button anchor", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", { html: "<p>Read <a href=\"#\">more</a></p>" }),
      ]),
    ];
    const r = auditElementorTree(sections);
    // Has an <a> inside the <p> → paragraph-only matcher rejects
    expect(r.suggestions).toHaveLength(0);
  });

  it("flags a single-button anchor HTML widget", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", { html: '<a href="#" class="btn">Click me</a>' }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("button");
  });

  it("flags <details>/<summary> FAQ markup", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", {
          html: `<details><summary>Q1</summary>A1</details><details><summary>Q2</summary>A2</details>`,
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("accordion");
    expect(r.suggestions[0]!.suggestedPattern).toBe("P-003");
  });

  it("flags data-count counter markup", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", {
          html: '<div data-count="120" data-suffix="+">0</div>',
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("counter");
  });

  it("flags icon-box style card content", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", {
          html: `<div class="card"><svg><path d="M0 0"/></svg><h3>Web Dev</h3><p>Custom WordPress.</p></div>`,
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("icon-box");
    expect(r.suggestions[0]!.suggestedPattern).toBe("P-002");
  });

  it("does NOT flag custom marquee / terminal HTML blocks", () => {
    const sections = [
      makeSection([
        widget("term", "html", {
          html: `<div class="terminal"><div class="terminal-body" data-typer='[]'></div></div>`,
        }),
        widget("marq", "html", {
          html: `<div class="marquee"><div class="marquee-track">...</div></div>`,
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    // No suggestions — these patterns are acceptable HTML widgets
    expect(r.suggestions).toHaveLength(0);
  });

  it("computes percentage correctly for mixed widget trees", () => {
    const sections = [
      makeSection([
        widget("a", "heading"),
        widget("b", "heading"),
        widget("c", "text-editor"),
        widget("d", "html", { html: "<div>custom</div>" }),
        widget("e", "html", { html: "<div>custom</div>" }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.totalWidgets).toBe(5);
    expect(r.htmlWidgets).toBe(2);
    expect(r.htmlWidgetPct).toBe(40);
  });

  it("plain markup conversions carry no fidelity risk", () => {
    const sections = [
      makeSection([widget("wid1", "html", { html: "<h1>We build websites</h1>" })]),
    ];
    const r = auditElementorTree(sections);
    expect(r.lossyWidgets).toBe(0);
    expect(r.guidance).toBeUndefined();
    expect(r.suggestions[0]!.fidelityRisk).toBeUndefined();
    expect(r.suggestions[0]!.wouldLose).toBeUndefined();
  });

  it("grades inline CSS / gradient / font as LOW fidelity risk on a converted widget", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", {
          html: '<h1 style="font-family:\'JetBrains Mono\';background:linear-gradient(90deg,#fff,#000)">Headline</h1>',
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("heading");
    expect(r.suggestions[0]!.fidelityRisk).toBe("low");
    expect(r.suggestions[0]!.wouldLose).toContain("custom font-family (typography identity)");
    expect(r.suggestions[0]!.wouldLose).toContain("CSS gradients");
    expect(r.lossyWidgets).toBe(1);
    expect(r.guidance).toBeTruthy();
  });

  it("grades animation / JS as HIGH fidelity risk", () => {
    const sections = [
      makeSection([
        widget("wid1", "html", {
          html: '<div data-count="120">0</div><style>@keyframes pop{from{opacity:0}}</style>',
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    expect(r.suggestions[0]!.suggestedWidget).toBe("counter");
    expect(r.suggestions[0]!.fidelityRisk).toBe("high");
    expect(r.suggestions[0]!.wouldLose).toContain("CSS animations / transitions");
  });

  it("counts lossy widgets even when no conversion is suggested", () => {
    const sections = [
      makeSection([
        widget("term", "html", {
          html: `<div class="terminal" data-typer='[]'><script>init()</script></div>`,
        }),
        widget("marq", "html", {
          html: `<div class="marquee" style="animation:scroll 10s linear infinite">x</div>`,
        }),
      ]),
    ];
    const r = auditElementorTree(sections);
    // Custom blocks → correctly NOT suggested for conversion...
    expect(r.suggestions).toHaveLength(0);
    // ...but still flagged lossy so the agent knows the page carries design.
    expect(r.lossyWidgets).toBe(2);
    expect(r.guidance).toBeTruthy();
  });

  it("recurses into inner sections", () => {
    const sections = [
      {
        id: "outer",
        elType: "section",
        elements: [
          {
            id: "col1",
            elType: "column",
            elements: [
              widget("a", "heading"),
              {
                id: "inner",
                elType: "section",
                isInner: true,
                elements: [
                  {
                    id: "col2",
                    elType: "column",
                    elements: [
                      widget("b", "counter"),
                      widget("c", "counter"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const r = auditElementorTree(sections);
    expect(r.totalWidgets).toBe(3);
    expect(r.widgetTypeCounts).toEqual({ heading: 1, counter: 2 });
  });
});
