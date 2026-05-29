import { describe, it, expect } from "vitest";
import { decodeElementorData } from "../../src/lib/elementorData.js";

const TREE = [
  { id: "a", elType: "section", settings: { _css_classes: "wnz-hero" } },
];

describe("decodeElementorData", () => {
  it("passes through a plain array", () => {
    expect(decodeElementorData(TREE)).toEqual(TREE);
  });

  it("decodes a single JSON-encoded string", () => {
    expect(decodeElementorData(JSON.stringify(TREE))).toEqual(TREE);
  });

  it("decodes the double-encoded form (wp --format=json on a json-string meta)", () => {
    const doubled = JSON.stringify(JSON.stringify(TREE));
    expect(decodeElementorData(doubled)).toEqual(TREE);
  });

  it("treats empty string as an empty tree", () => {
    expect(decodeElementorData("")).toEqual([]);
    expect(decodeElementorData('""')).toEqual([]);
  });

  it("throws when the payload is not a section array", () => {
    expect(() => decodeElementorData('{"not":"an array"}')).toThrow(
      /section array/,
    );
  });
});
