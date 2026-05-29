import { describe, it, expect } from "vitest";
import {
  validateElementorData,
  collectStructuralWarnings,
} from "../../src/lib/elementorValidator.js";
import type { Target } from "../../src/runtime/Target.js";

function targetWithSchema(
  perWidget: Record<string, Record<string, { type: string }>>,
): Target {
  return {
    id: "tgt_test1234",
    kind: "rest",
    siteurl: "https://example.com",
    wpVersion: "7.0",
    companion: {
      installed: true,
      enabled: true,
      version: "2.11.0",
      capabilities: [],
    },
    rest: async (req) => {
      // Mock the handshake / session-token issue CompanionBridge runs
      // before every endpoint call.
      if (req.path === "/wplab/v1/handshake") {
        return {
          status: 200,
          body: {
            companion_version: "2.11.0",
            capabilities: [],
            session_token: "test-token",
            session_expires_at: Date.now() / 1000 + 3600,
          },
          headers: {},
        };
      }
      if (req.path !== "/wplab/v1/elementor/widget-schema") {
        return { status: 404, body: { code: "rest_no_route" }, headers: {} };
      }
      const widget = (req.query as Record<string, unknown> | undefined)?.[
        "widget"
      ];
      if (typeof widget !== "string" || !perWidget[widget]) {
        return {
          status: 404,
          body: { ok: false, error_code: "WIDGET_NOT_FOUND" },
          headers: {},
        };
      }
      const controls: Record<string, { type: string }> = perWidget[widget]!;
      return {
        status: 200,
        body: {
          ok: true,
          elementor_version: "4.1.1",
          widget_type: widget,
          controls,
        },
        headers: {},
      };
    },
    rootPath: () => "https://example.com",
    wpCli: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0 }),
    fileRead: async () => ({ content: "", bytes: 0, absolutePath: "" }),
    fileWrite: async () => ({
      bytesWritten: 0,
      backupPath: null,
      absolutePath: "",
    }),
    fileExists: async () => false,
    close: async () => {},
  } as unknown as Target;
}

describe("validateElementorData", () => {
  it("returns ok=true on empty sections", async () => {
    const r = await validateElementorData(targetWithSchema({}), []);
    expect(r.ok).toBe(true);
    expect(r.widgets_scanned).toBe(0);
    expect(r.errors).toHaveLength(0);
  });

  it("catches the WalnutZtudio accordion `icon` Array bug", async () => {
    // Legacy accordion `icon` control is a `text` type (expects string).
    // Pre-Phase-3 we passed { value, library } — Elementor rendered "Array".
    const sections = [
      {
        id: "sec1",
        elType: "section",
        elements: [
          {
            id: "col1",
            elType: "column",
            elements: [
              {
                id: "wid1",
                elType: "widget",
                widgetType: "accordion",
                settings: {
                  icon: { value: "fas fa-plus", library: "fa-solid" }, // bug shape
                },
              },
            ],
          },
        ],
      },
    ];
    const target = targetWithSchema({
      accordion: { icon: { type: "icon" } },
    });
    const r = await validateElementorData(target, sections);
    expect(r.ok).toBe(false);
    expect(r.widgets_scanned).toBe(1);
    expect(r.widget_types_seen).toEqual(["accordion"]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]!.setting_key).toBe("icon");
    expect(r.errors[0]!.actual_type).toBe("object");
    expect(r.errors[0]!.reason).toContain("legacy icon");
  });

  it("passes when accordion icon is a proper string", async () => {
    const sections = [
      {
        id: "sec1",
        elType: "section",
        elements: [
          {
            id: "col1",
            elType: "column",
            elements: [
              {
                id: "wid1",
                elType: "widget",
                widgetType: "accordion",
                settings: { icon: "fa fa-plus" },
              },
            ],
          },
        ],
      },
    ];
    const r = await validateElementorData(
      targetWithSchema({ accordion: { icon: { type: "icon" } } }),
      sections,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("treats unknown setting keys as warnings by default, errors when strict", async () => {
    const sections = [
      {
        id: "sec1",
        elType: "section",
        elements: [
          {
            id: "col1",
            elType: "column",
            elements: [
              {
                id: "wid1",
                elType: "widget",
                widgetType: "heading",
                settings: { title: "Hello", nonexistent_key: "x" },
              },
            ],
          },
        ],
      },
    ];
    const target = targetWithSchema({
      heading: { title: { type: "text" } },
    });

    const lenient = await validateElementorData(target, sections);
    expect(lenient.ok).toBe(true);
    expect(lenient.warnings).toHaveLength(1);
    expect(lenient.warnings[0]!.setting_key).toBe("nonexistent_key");

    const strict = await validateElementorData(target, sections, {
      strict: true,
    });
    expect(strict.ok).toBe(false);
    expect(strict.errors).toHaveLength(1);
    expect(strict.errors[0]!.setting_key).toBe("nonexistent_key");
  });

  it("ignores Elementor-internal `_css_classes` and other `_*` keys", async () => {
    const sections = [
      {
        id: "sec1",
        elType: "section",
        elements: [
          {
            id: "col1",
            elType: "column",
            elements: [
              {
                id: "wid1",
                elType: "widget",
                widgetType: "heading",
                settings: { title: "X", _css_classes: "wnz-headline" },
              },
            ],
          },
        ],
      },
    ];
    const r = await validateElementorData(
      targetWithSchema({ heading: { title: { type: "text" } } }),
      sections,
    );
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });

  it("counts every widget type seen even when nested deep", async () => {
    const sections = [
      {
        elType: "section",
        elements: [
          {
            elType: "column",
            elements: [
              {
                elType: "widget",
                widgetType: "heading",
                id: "a",
                settings: { title: "x" },
              },
              {
                elType: "section",
                isInner: true,
                elements: [
                  {
                    elType: "column",
                    elements: [
                      {
                        elType: "widget",
                        widgetType: "counter",
                        id: "b",
                        settings: { ending_number: 7 },
                      },
                      {
                        elType: "widget",
                        widgetType: "button",
                        id: "c",
                        settings: { text: "Go" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const target = targetWithSchema({
      heading: { title: { type: "text" } },
      counter: { ending_number: { type: "number" } },
      button: { text: { type: "text" } },
    });
    const r = await validateElementorData(target, sections);
    expect(r.widgets_scanned).toBe(3);
    expect(r.widget_types_seen).toEqual(["button", "counter", "heading"]);
    expect(r.ok).toBe(true);
  });
});

describe("collectStructuralWarnings", () => {
  it("warns once about section-level _css_classes (aggregated)", () => {
    const sections = [
      {
        id: "s1",
        elType: "section",
        settings: { _css_classes: "wnz-hero" },
        elements: [],
      },
      {
        id: "s2",
        elType: "section",
        settings: { _css_classes: "wnz-services" },
        elements: [],
      },
      { id: "s3", elType: "section", settings: {}, elements: [] },
    ];
    const w = collectStructuralWarnings(sections);
    const sectionW = w.filter((x) => x.widget_type === "section");
    expect(sectionW).toHaveLength(1);
    expect(sectionW[0]!.reason).toMatch(/does NOT emit section-level/i);
    expect(sectionW[0]!.widget_id).toBe("s1, s2");
  });

  it("does not warn when no section sets _css_classes", () => {
    const sections = [
      { id: "s1", elType: "section", settings: {}, elements: [] },
    ];
    expect(collectStructuralWarnings(sections)).toHaveLength(0);
  });

  it("warns about block-level HTML in an icon-box description", () => {
    const sections = [
      {
        id: "s1",
        elType: "section",
        elements: [
          {
            id: "w1",
            elType: "widget",
            widgetType: "icon-box",
            settings: {
              description_text: "<span>ok</span><ul><li>x</li></ul>",
            },
          },
        ],
      },
    ];
    const w = collectStructuralWarnings(sections);
    const iconW = w.filter((x) => x.widget_type === "icon-box");
    expect(iconW).toHaveLength(1);
    expect(iconW[0]!.setting_key).toBe("description_text");
  });

  it("does not warn on a plain-text icon-box description", () => {
    const sections = [
      {
        id: "s1",
        elType: "section",
        elements: [
          {
            id: "w1",
            elType: "widget",
            widgetType: "icon-box",
            settings: { description_text: "just plain text, no blocks" },
          },
        ],
      },
    ];
    expect(collectStructuralWarnings(sections)).toHaveLength(0);
  });

  it("recurses into inner sections for _css_classes", () => {
    const sections = [
      {
        id: "outer",
        elType: "section",
        settings: {},
        elements: [
          {
            id: "col",
            elType: "column",
            elements: [
              {
                id: "inner",
                elType: "section",
                settings: { _css_classes: "wnz-svc-grid" },
                elements: [],
              },
            ],
          },
        ],
      },
    ];
    const w = collectStructuralWarnings(sections);
    expect(w.filter((x) => x.widget_type === "section")).toHaveLength(1);
    expect(w[0]!.widget_id).toBe("inner");
  });
});
