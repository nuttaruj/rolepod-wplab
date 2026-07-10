import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listToolDefs } from "../../src/tools/registerTools.js";
import { zodToJsonSchema } from "../../src/tools/zodToJsonSchema.js";
import { UNDOCUMENTED_TOOLS } from "./undocumented-tools.allowlist.js";

const DOC_ROOTS = ["skills", "README.md"];

function walk(path: string): string[] {
  if (statSync(path).isFile()) return path.endsWith(".md") ? [path] : [];
  return readdirSync(path).flatMap((entry) => walk(join(path, entry)));
}

const DOCS = DOC_ROOTS.flatMap(walk);

const TOOL_NAMES = new Set(listToolDefs().map((d) => d.name));

/** Top-level input keys, per tool. */
const TOOL_PARAMS = new Map(
  listToolDefs().map((d) => {
    const schema = zodToJsonSchema(d.inputSchema) as {
      properties?: Record<string, unknown>;
    };
    return [d.name, new Set(Object.keys(schema.properties ?? {}))];
  }),
);

interface Citation {
  file: string;
  line: number;
  tool: string;
  /** null when the doc mentions the tool without an argument list */
  params: string[] | null;
}

/**
 * Tool citations live in inline code spans: `rolepod_wp_foo(a, b: 1)`.
 *
 * Only backtick spans are scanned, so prose like an `audit_id` value or a
 * `pair_token` literal — both of which start with `rolepod_wp_` — is not
 * mistaken for a tool. A leading `.` (as in `wp_options.rolepod_wp_audit_log`)
 * marks a database identifier, not a tool.
 *
 * `rolepod_wp_elementor_{read,write}` is shorthand for two tools; both are
 * checked.
 */
function citations(file: string): Citation[] {
  const out: Citation[] = [];
  const lines = readFileSync(file, "utf8").split("\n");

  lines.forEach((line, i) => {
    for (const span of line.matchAll(/`([^`]+)`/g)) {
      const code = span[1]!;
      for (const m of code.matchAll(/(^|[^.\w])(rolepod_wp_[a-z0-9_]*)/g)) {
        const raw = m[2]!;
        const after = code.slice(m.index! + m[0]!.length);
        // `rolepod_wp_connect_<kind>`, `rolepod_wp_scaffold_*`, `rolepod_wp_*`
        // are placeholders for a family of tools, not citations of one.
        if (after.startsWith("<") || after.startsWith("*")) continue;
        for (const tool of expandShorthand(raw, after)) {
          const params = after.startsWith("(") ? parseArgs(after) : null;
          out.push({ file, line: i + 1, tool, params });
        }
      }
    }
  });
  return out;
}

/**
 * `rolepod_wp_elementor_` + `{read,write}` → both full names.
 *
 * A stem that ends in `_` with nothing after it is a prefix being discussed as
 * text ("the token MUST start with `rolepod_wp_pair_`"), not a tool.
 */
function expandShorthand(stem: string, after: string): string[] {
  const brace = /^\{([a-z0-9_,\s]+)\}/.exec(after);
  if (brace) return brace[1]!.split(",").map((suffix) => stem + suffix.trim());
  return stem.endsWith("_") ? [] : [stem];
}

/** Names on the left of `:` or `=`, plus bare identifiers. Values are ignored. */
function parseArgs(fromParen: string): string[] | null {
  let depth = 0;
  let end = -1;
  for (let i = 0; i < fromParen.length; i++) {
    if (fromParen[i] === "(") depth++;
    else if (fromParen[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null; // unbalanced — prose, not a call

  const inner = fromParen.slice(1, end);
  if (!inner.trim()) return [];

  return splitTopLevel(inner)
    .map((arg) => {
      const name = arg.split(/[:=]/)[0]!.trim();
      return /^[a-z_][a-z0-9_]*$/.test(name) ? name : "";
    })
    .filter(Boolean);
}

function splitTopLevel(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let buf = "";
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim()) parts.push(buf);
  return parts;
}

const ALL = DOCS.flatMap(citations);

describe("skill/doc drift — documentation must match the registered tools", () => {
  it("finds tool citations to check", () => {
    expect(DOCS.length).toBeGreaterThan(10);
    expect(ALL.length).toBeGreaterThan(50);
  });

  it("cites no tool that does not exist", () => {
    const unknown = ALL.filter((c) => !TOOL_NAMES.has(c.tool)).map(
      (c) => `${c.file}:${c.line} → ${c.tool}`,
    );
    expect(unknown).toEqual([]);
  });

  it("passes no parameter a tool does not accept", () => {
    const bad: string[] = [];
    for (const c of ALL) {
      if (!c.params || !TOOL_NAMES.has(c.tool)) continue;
      const accepted = TOOL_PARAMS.get(c.tool)!;
      for (const p of c.params) {
        if (!accepted.has(p)) {
          bad.push(`${c.file}:${c.line} → ${c.tool}(${p}) — not in schema`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  /**
   * Identifiers the docs used to promise and the code never had. Each may only
   * appear on a line that says it does not exist — otherwise the fiction has
   * crept back in.
   */
  it.each([
    ["_wplab_backup", "adapter backups are files, not a meta side-row"],
    ["BACKUP_FAILED", "no such error code"],
    ["plan_id", "migrate_data has no plan_id"],
    ["GF_REST", "Gravity Forms writes go through wp-cli"],
    ["rolepod_wp_elementor_widget_inventory", "the tool is widget_schema"],
  ])("does not resurrect `%s` — %s", (token) => {
    const affirmed: string[] = [];
    for (const file of DOCS) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes(token)) return;
          if (/\b(no|not|never|cannot)\b/i.test(line)) return; // a denial
          affirmed.push(`${file}:${i + 1}`);
        });
    }
    expect(affirmed).toEqual([]);
  });

  it.each(["README.md", ".claude-plugin/plugin.json"])(
    "%s quotes the real tool count",
    (file) => {
      const claimed = [
        ...readFileSync(file, "utf8").matchAll(/(\d+)\+? MCP tools/g),
      ].map((m) => Number(m[1]));
      expect(claimed.length).toBeGreaterThan(0);
      for (const n of claimed) expect(n).toBe(TOOL_NAMES.size);
    },
  );

  it("documents every tool, except the ones on the shrink-only allowlist", () => {
    const cited = new Set(ALL.map((c) => c.tool));
    const undocumented = [...TOOL_NAMES].filter((n) => !cited.has(n)).sort();

    const notAllowed = undocumented.filter(
      (n) => !UNDOCUMENTED_TOOLS.includes(n),
    );
    expect(notAllowed).toEqual([]);

    // Ratchet: once a tool gets documented it may never go back.
    const staleAllowlist = UNDOCUMENTED_TOOLS.filter((n) => cited.has(n));
    expect(staleAllowlist).toEqual([]);
  });
});
