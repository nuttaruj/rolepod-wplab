import { describe, it, expect } from "vitest";
import { matchSectionIndices } from "../../src/tools/composite/wp_elementor_section.js";

const sections = [
  { id: "aa", settings: { _css_classes: "wnz-sec wnz-hero" } },
  { id: "bb", settings: { _css_classes: "wnz-sec wnz-services" } },
  { id: "cc", settings: { _css_classes: "wnz-sec wnz-services-grid" } },
  { id: "dd", settings: {} },
];

describe("matchSectionIndices", () => {
  it("matches by element id", () => {
    expect(matchSectionIndices(sections, "bb", undefined)).toEqual([1]);
  });

  it("matches by exact class token (not substring)", () => {
    // 'wnz-services' must NOT match 'wnz-services-grid' (token-exact)
    expect(matchSectionIndices(sections, undefined, "wnz-services")).toEqual([1]);
  });

  it("matches multiple sections sharing a class", () => {
    expect(matchSectionIndices(sections, undefined, "wnz-sec")).toEqual([0, 1, 2]);
  });

  it("returns empty when nothing matches", () => {
    expect(matchSectionIndices(sections, "zz", undefined)).toEqual([]);
    expect(matchSectionIndices(sections, undefined, "nope")).toEqual([]);
  });

  it("handles sections with no _css_classes", () => {
    expect(matchSectionIndices(sections, "dd", undefined)).toEqual([3]);
    expect(matchSectionIndices(sections, undefined, "anything")).not.toContain(3);
  });
});
