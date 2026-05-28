/**
 * Schema-driven `_elementor_data` validation.
 *
 * Pulls the per-widget controls schema via the companion's
 * `/wplab/v1/elementor/widget-schema` endpoint, walks the section tree,
 * and reports every setting key that:
 *
 *   - exists on the widget but holds a value of the wrong shape (e.g.
 *     `icon: { value, library }` when the registered control type is a
 *     plain `text` — the WalnutZtudio accordion "Array" bug);
 *   - is not declared on the widget at all (probable typo OR a control
 *     that was renamed/removed across Elementor versions).
 *
 * Schema caching: each distinct widget type is fetched at most once per
 * call so a 9-section / 20-widget page costs ~7 round-trips, not 20.
 */
import { CompanionBridge } from "../companion/Bridge.js";
import { WplabError } from "../util/errors.js";
import { log } from "../util/log.js";
import type { Target } from "../runtime/Target.js";

export interface ValidationError {
  widget_id: string;
  widget_type: string;
  setting_key: string;
  reason: string;
  expected_type?: string;
  actual_type?: string;
}

export interface ValidationWarning {
  widget_id: string;
  widget_type: string;
  setting_key: string;
  reason: string;
}

export interface ValidationResult {
  ok: boolean;
  widgets_scanned: number;
  widget_types_seen: string[];
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const SCHEMA_CACHE_KEY = Symbol("elementor-schema-cache");

interface WidgetSchema {
  controls: Record<string, ControlSchema>;
}
interface ControlSchema {
  type?: string;
  options?: unknown;
  default?: unknown;
}

export async function validateElementorData(
  target: Target,
  sections: ReadonlyArray<Record<string, unknown>>,
  opts: { strict?: boolean } = {},
): Promise<ValidationResult> {
  if (target.kind !== "rest") {
    throw new WplabError(
      "ELEMENTOR_VALIDATE_UNSUPPORTED_TARGET",
      "elementor data validation requires a `rest` target (uses the companion endpoint).",
      { target_kind: target.kind },
    );
  }
  const bridge = new CompanionBridge(target);
  const schemaCache = new Map<string, WidgetSchema | null>();
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const typesSeen = new Set<string>();
  let scanned = 0;

  async function getSchema(widgetType: string): Promise<WidgetSchema | null> {
    if (schemaCache.has(widgetType)) return schemaCache.get(widgetType)!;
    try {
      const raw = await bridge.elementorWidgetSchema(widgetType);
      const controls =
        raw && typeof raw === "object" && raw["controls"] && typeof raw["controls"] === "object"
          ? (raw["controls"] as Record<string, ControlSchema>)
          : {};
      const schema: WidgetSchema = { controls };
      schemaCache.set(widgetType, schema);
      return schema;
    } catch (err) {
      log.debug("widget schema fetch failed", {
        widget: widgetType,
        err: (err as Error).message,
      });
      schemaCache.set(widgetType, null);
      return null;
    }
  }

  async function walk(node: Record<string, unknown>): Promise<void> {
    const widgetType = typeof node["widgetType"] === "string" ? (node["widgetType"] as string) : "";
    if (widgetType !== "") {
      typesSeen.add(widgetType);
      scanned++;
      const widgetId =
        typeof node["id"] === "string" ? (node["id"] as string) : "<no-id>";
      const settings =
        node["settings"] && typeof node["settings"] === "object"
          ? (node["settings"] as Record<string, unknown>)
          : null;
      if (settings) {
        const schema = await getSchema(widgetType);
        if (schema) {
          for (const [key, value] of Object.entries(settings)) {
            if (key.startsWith("_")) continue; // Elementor's internal "_css_classes" etc — present on every widget, not advertised in get_controls()
            const control = schema.controls[key];
            if (!control) {
              const w: ValidationWarning = {
                widget_id: widgetId,
                widget_type: widgetType,
                setting_key: key,
                reason: "setting key not declared in widget's controls registry",
              };
              if (opts.strict) {
                errors.push({ ...w, actual_type: actualType(value) });
              } else {
                warnings.push(w);
              }
              continue;
            }
            const issue = validateValueAgainstControl(value, control);
            if (issue) {
              errors.push({
                widget_id: widgetId,
                widget_type: widgetType,
                setting_key: key,
                reason: issue.reason,
                expected_type: issue.expected,
                actual_type: actualType(value),
              });
            }
          }
        }
      }
    }
    // Recurse into elements (section / column / inner section).
    const elements = node["elements"];
    if (Array.isArray(elements)) {
      for (const child of elements) {
        if (child && typeof child === "object") {
          await walk(child as Record<string, unknown>);
        }
      }
    }
  }

  for (const section of sections) {
    if (section && typeof section === "object") {
      await walk(section);
    }
  }

  return {
    ok: errors.length === 0,
    widgets_scanned: scanned,
    widget_types_seen: [...typesSeen].sort(),
    errors,
    warnings,
  };
}

/**
 * Lightweight type-shape check. Targets the WalnutZtudio class of bug
 * (passing a `{value, library}` icon object to a legacy string-icon
 * control). Doesn't try to be a JSON Schema validator — Elementor's
 * control types are too loose for that.
 */
function validateValueAgainstControl(
  value: unknown,
  control: ControlSchema,
): { reason: string; expected: string } | null {
  const t = control.type ?? "";
  switch (t) {
    case "text":
    case "textarea":
    case "code":
    case "url":
    case "hidden": {
      if (typeof value !== "string" && value !== null && value !== undefined) {
        return { reason: `expected a string, got ${actualType(value)}`, expected: "string" };
      }
      return null;
    }
    case "icon": {
      // Legacy `icon` control expects a string class like "fa fa-plus".
      if (typeof value !== "string") {
        return {
          reason: `legacy icon control expects a string (e.g. 'fa fa-plus'). Pass that, not the new selected_icon { value, library } array.`,
          expected: "string",
        };
      }
      return null;
    }
    case "switcher": {
      const ok = value === "yes" || value === "" || typeof value === "boolean";
      if (!ok) {
        return { reason: `switcher expects 'yes' | '' | boolean, got ${actualType(value)}`, expected: "'yes' | '' | boolean" };
      }
      return null;
    }
    case "number": {
      if (value !== null && value !== undefined && typeof value !== "number" && typeof value !== "string") {
        return { reason: `number control expects number or numeric string, got ${actualType(value)}`, expected: "number" };
      }
      return null;
    }
    case "repeater": {
      if (!Array.isArray(value)) {
        return { reason: `repeater control expects an array of items, got ${actualType(value)}`, expected: "array" };
      }
      return null;
    }
    default:
      // Unknown / complex control type — skip type check, key existence
      // alone is already a useful signal.
      return null;
  }
}

function actualType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
