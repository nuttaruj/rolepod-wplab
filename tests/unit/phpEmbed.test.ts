import { describe, expect, it } from "vitest";
import {
  escapeBlockComment,
  phpJsonArg,
  phpLiteral,
  phpQuote,
} from "../../src/lib/phpEmbed.js";

/**
 * The security property: whatever string goes in, the emitted PHP single-quoted
 * literal cannot be broken out of. After stripping the outer quotes, every `'`
 * must be backslash-escaped and every `\` doubled.
 */
function cannotEscape(quoted: string): boolean {
  // Must be wrapped in single quotes.
  if (!quoted.startsWith("'") || !quoted.endsWith("'")) return false;
  const inner = quoted.slice(1, -1);
  // Walk the inner text: a backslash consumes the next char (escape pair);
  // a bare single quote would terminate the literal early → unsafe.
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\") {
      i++; // skip the escaped char
      continue;
    }
    if (inner[i] === "'") return false;
  }
  return true;
}

describe("phpEmbed — phpQuote", () => {
  it("escapes single quotes and backslashes", () => {
    expect(phpQuote("a'b")).toBe("'a\\'b'");
    expect(phpQuote("a\\b")).toBe("'a\\\\b'");
    expect(phpQuote("plain")).toBe("'plain'");
  });

  it("neutralizes injection payloads (adversarial round-trip)", () => {
    const payloads = [
      "'; system('rm -rf /'); //",
      "\\'; echo 1; //",
      "'.file_get_contents('/etc/passwd').'",
      "normal text",
      "backslash at end \\",
      "\\\\' double",
      "$wpdb->query('DROP')",
    ];
    for (const p of payloads) {
      expect(cannotEscape(phpQuote(p))).toBe(true);
    }
  });
});

describe("phpEmbed — phpLiteral", () => {
  it("emits bare numbers and booleans, quoted strings", () => {
    expect(phpLiteral(5)).toBe("5");
    expect(phpLiteral(0)).toBe("0");
    expect(phpLiteral(true)).toBe("true");
    expect(phpLiteral(false)).toBe("false");
    expect(phpLiteral("x")).toBe("'x'");
    expect(phpLiteral("a'b")).toBe("'a\\'b'");
  });
});

describe("phpEmbed — phpJsonArg", () => {
  it("wraps a json_decode of a phpQuoted JSON string", () => {
    expect(phpJsonArg({ a: 1 })).toBe("json_decode('{\"a\":1}', true)");
    expect(phpJsonArg([1, 2])).toBe("json_decode('[1,2]', true)");
  });

  it("keeps single quotes inside the JSON escaped (no breakout)", () => {
    const out = phpJsonArg({ a: "it's" });
    // The emitted json_decode('...') argument must itself be un-escapable.
    const arg = out.slice("json_decode(".length, out.lastIndexOf(", true)"));
    expect(cannotEscape(arg)).toBe(true);
  });
});

describe("phpEmbed — escapeBlockComment", () => {
  it("neutralizes a comment terminator", () => {
    expect(escapeBlockComment("before */ after")).toBe("before * / after");
    expect(escapeBlockComment("clean")).toBe("clean");
  });
});
