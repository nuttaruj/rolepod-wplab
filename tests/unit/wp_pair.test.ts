import { describe, expect, it } from "vitest";
import { PairInputSchema, PairOutputSchema } from "../../src/schema/tools.js";

describe("PairInputSchema — wire format gate", () => {
  it("accepts well-formed https url + 48-hex token", () => {
    const v = PairInputSchema.parse({
      siteurl: "https://walnutztudio.com",
      pair_token: "wplab_pair_" + "a".repeat(48),
    });
    expect(v.siteurl).toBe("https://walnutztudio.com");
    expect(v.pair_token.length).toBe("wplab_pair_".length + 48);
  });

  it("rejects http (non-https) siteurl — pair must never traverse plaintext", () => {
    expect(() =>
      PairInputSchema.parse({
        siteurl: "http://walnutztudio.com",
        pair_token: "wplab_pair_" + "0".repeat(48),
      }),
    ).toThrow();
  });

  it("rejects malformed pair_token (wrong prefix)", () => {
    expect(() =>
      PairInputSchema.parse({
        siteurl: "https://walnutztudio.com",
        pair_token: "wplab_sess_" + "0".repeat(48),
      }),
    ).toThrow();
  });

  it("rejects malformed pair_token (wrong length)", () => {
    expect(() =>
      PairInputSchema.parse({
        siteurl: "https://walnutztudio.com",
        pair_token: "wplab_pair_abc",
      }),
    ).toThrow();
  });

  it("rejects malformed pair_token (non-hex chars)", () => {
    expect(() =>
      PairInputSchema.parse({
        siteurl: "https://walnutztudio.com",
        pair_token: "wplab_pair_" + "z".repeat(48),
      }),
    ).toThrow();
  });
});

describe("PairOutputSchema — response shape gate", () => {
  it("accepts a complete companion response", () => {
    const v = PairOutputSchema.parse({
      target_id: "tgt_abcdef012345",
      siteurl: "https://walnutztudio.com",
      username: "admin",
      capabilities: ["introspect_hooks", "execute_php"],
      companion_version: "1.2.0",
      is_production: false,
      app_password_name: "wplab-pair-20260526T000123",
      credential_stored: true,
    });
    expect(v.target_id).toMatch(/^tgt_/);
    expect(v.capabilities).toContain("execute_php");
  });

  it("rejects bad target_id format", () => {
    expect(() =>
      PairOutputSchema.parse({
        target_id: "not-a-target",
        siteurl: "https://walnutztudio.com",
        username: "admin",
        capabilities: [],
        companion_version: "1.2.0",
        is_production: false,
        app_password_name: "wplab-pair-x",
        credential_stored: false,
      }),
    ).toThrow();
  });
});
