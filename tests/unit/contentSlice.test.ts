import { describe, it, expect } from "vitest";
import { sliceContent } from "../../src/lib/contentSlice.js";

const SAMPLE = ["alpha", "beta", "GAMMA", "delta", "beta-two", "omega"].join(
  "\n",
);

describe("sliceContent", () => {
  it("returns full content unsliced when no opts", () => {
    const r = sliceContent(SAMPLE);
    expect(r.sliced).toBe(false);
    expect(r.content).toBe(SAMPLE);
    expect(r.totalBytes).toBe(Buffer.byteLength(SAMPLE));
    expect(r.truncated).toBe(false);
  });

  it("grep returns only matching lines + counts them", () => {
    const r = sliceContent(SAMPLE, { grep: "beta" });
    expect(r.sliced).toBe(true);
    expect(r.matchedLines).toBe(2);
    expect(r.content).toBe("beta\nbeta-two");
  });

  it("grep with context pulls neighbouring lines", () => {
    const r = sliceContent(SAMPLE, { grep: "GAMMA", context: 1 });
    expect(r.content).toBe("beta\nGAMMA\ndelta");
    expect(r.matchedLines).toBe(1);
  });

  it("grep ignoreCase", () => {
    const r = sliceContent(SAMPLE, { grep: "gamma", ignoreCase: true });
    expect(r.matchedLines).toBe(1);
    expect(r.content).toBe("GAMMA");
  });

  it("offset + limit slices a line range (1-based)", () => {
    const r = sliceContent(SAMPLE, { offset: 2, limit: 2 });
    expect(r.content).toBe("beta\nGAMMA");
    expect(r.sliced).toBe(true);
  });

  it("max_bytes truncates and flags truncated", () => {
    const r = sliceContent(SAMPLE, { maxBytes: 5 });
    expect(r.truncated).toBe(true);
    expect(r.returnedBytes).toBeLessThanOrEqual(5);
    expect(r.totalBytes).toBe(Buffer.byteLength(SAMPLE));
  });

  it("max_bytes respects UTF-8 boundaries", () => {
    const thai = "ก".repeat(100); // each ก = 3 bytes
    const r = sliceContent(thai, { maxBytes: 7 });
    // never split a multibyte char → <= 6 bytes (2 chars), valid string
    expect(r.returnedBytes).toBeLessThanOrEqual(7);
    expect(() => JSON.stringify(r.content)).not.toThrow();
    expect(r.content).toBe("กก");
  });
});
