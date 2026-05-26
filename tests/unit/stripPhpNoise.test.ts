import { describe, expect, it } from "vitest";
import { stripPhpNoise } from "../../src/runtime/wpCli.js";

describe("stripPhpNoise", () => {
  it("returns empty input unchanged", () => {
    expect(stripPhpNoise("")).toBe("");
  });

  it("keeps regular lines untouched", () => {
    expect(stripPhpNoise("http://localhost:8989")).toBe(
      "http://localhost:8989",
    );
  });

  it("strips PHP Deprecated lines", () => {
    const input = [
      "PHP Deprecated:  Case statements followed by a semicolon (;) are deprecated, use a colon (:) instead in /x.php on line 1",
      "6.6.2",
    ].join("\n");
    expect(stripPhpNoise(input)).toBe("6.6.2");
  });

  it('strips bare Deprecated lines (no "PHP " prefix)', () => {
    const input = ["Deprecated: foo", "http://localhost:8989"].join("\n");
    expect(stripPhpNoise(input)).toBe("http://localhost:8989");
  });

  it("strips PHP Warning / Warning lines", () => {
    const input = [
      'PHP Warning:  Undefined array key "HTTP_HOST"',
      "Warning: something",
      "siteurl-value",
    ].join("\n");
    expect(stripPhpNoise(input)).toBe("siteurl-value");
  });

  it("strips PHP Notice / Notice / Strict Standards lines", () => {
    const input = [
      "PHP Notice: Trying access on null",
      "Notice: undefined",
      "Strict Standards: deprecated method",
      "kept",
    ].join("\n");
    expect(stripPhpNoise(input)).toBe("kept");
  });

  it("trims leading + trailing whitespace after stripping", () => {
    const input = ["Deprecated: pad", "", "value", ""].join("\n");
    expect(stripPhpNoise(input)).toBe("value");
  });

  it("preserves valid JSON output that does not match noise patterns", () => {
    const input = '{"name":"akismet","status":"inactive"}';
    expect(stripPhpNoise(input)).toBe(input);
  });

  it("does not strip a line whose body contains the word Deprecated mid-string", () => {
    const input =
      "This is a Deprecated feature warning baked into our content.";
    expect(stripPhpNoise(input)).toBe(input);
  });
});
