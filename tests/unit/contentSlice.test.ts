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

import { capStreams } from "../../src/lib/contentSlice.js";

describe("capStreams — the cap rolepod_wp_cli_run / rolepod_wp_db_query apply", () => {
  it("leaves output under the cap untouched and reports it whole", () => {
    const r = capStreams("hello", "warn", 1024);
    expect(r.stdout).toBe("hello");
    expect(r.stderr).toBe("warn");
    expect(r.truncated).toBe(false);
    expect(r.totalBytes).toBe(9);
    expect(r.returnedBytes).toBe(9);
  });

  it("cuts stdout from the end and keeps the header row", () => {
    const rows = [
      "ID\tpost_title",
      ...Array.from({ length: 500 }, (_, i) => `${i}\tPost ${i}`),
    ];
    const big = rows.join("\n");
    const r = capStreams(big, "", 200);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stdout)).toBeLessThanOrEqual(200);
    expect(r.stdout.startsWith("ID\tpost_title\n")).toBe(true);
    expect(r.totalBytes).toBe(Buffer.byteLength(big));
    expect(r.returnedBytes).toBe(Buffer.byteLength(r.stdout));
  });

  it("caps stderr too — a PHP stack trace is output as well", () => {
    const trace = "PHP Fatal error: " + "x".repeat(5000);
    const r = capStreams("", trace, 100);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.stderr)).toBeLessThanOrEqual(100);
    expect(r.totalBytes).toBe(Buffer.byteLength(trace));
  });

  it("applies the cap per stream, so totals are sums", () => {
    const r = capStreams("a".repeat(150), "b".repeat(150), 100);
    expect(r.returnedBytes).toBe(200);
    expect(r.totalBytes).toBe(300);
    expect(r.truncated).toBe(true);
  });

  it("never splits a multibyte character", () => {
    const r = capStreams("ก".repeat(50), "", 7); // 3 bytes each
    expect(r.stdout).toBe("กก");
    expect(() => JSON.stringify(r.stdout)).not.toThrow();
  });
});
