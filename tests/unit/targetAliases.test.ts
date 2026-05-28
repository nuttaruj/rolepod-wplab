import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AliasStore,
  looksLikeAlias,
  aliasNameFromValue,
  ALIAS_NAME_RE,
} from "../../src/lib/targetAliases.js";

describe("looksLikeAlias", () => {
  it("recognizes @name shape", () => {
    expect(looksLikeAlias("@demo")).toBe(true);
    expect(looksLikeAlias("@staging-1")).toBe(true);
    expect(looksLikeAlias("@prod_eu")).toBe(true);
  });
  it("rejects bad shapes", () => {
    expect(looksLikeAlias("demo")).toBe(false);
    expect(looksLikeAlias("@")).toBe(false);
    expect(looksLikeAlias("@1demo")).toBe(false); // must start with letter
    expect(looksLikeAlias("@DEMO")).toBe(false); // lowercase only
    expect(looksLikeAlias("tgt_abcdef01")).toBe(false);
    expect(looksLikeAlias(123 as unknown)).toBe(false);
  });
});

describe("aliasNameFromValue", () => {
  it("strips leading @", () => {
    expect(aliasNameFromValue("@demo")).toBe("demo");
  });
  it("leaves a non-prefixed string alone", () => {
    expect(aliasNameFromValue("demo")).toBe("demo");
  });
});

describe("ALIAS_NAME_RE", () => {
  it("accepts representative names", () => {
    expect(ALIAS_NAME_RE.test("demo")).toBe(true);
    expect(ALIAS_NAME_RE.test("staging-2")).toBe(true);
    expect(ALIAS_NAME_RE.test("prod_eu_west")).toBe(true);
  });
  it("rejects bad names", () => {
    expect(ALIAS_NAME_RE.test("")).toBe(false);
    expect(ALIAS_NAME_RE.test("1demo")).toBe(false);
    expect(ALIAS_NAME_RE.test("DEMO")).toBe(false);
    expect(ALIAS_NAME_RE.test("a".repeat(40))).toBe(false);
  });
});

describe("AliasStore", () => {
  let tmp: string;
  let file: string;
  let store: AliasStore;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "wplab-aliases-"));
    file = join(tmp, "aliases.json");
    store = new AliasStore(file);
  });

  it("returns empty list when file does not exist", async () => {
    expect(await store.list()).toEqual([]);
  });

  it("persists set + get + list", async () => {
    await store.set({
      alias: "demo",
      siteurl: "https://example.com",
      credential_ref: "example.com",
    });
    const got = await store.get("demo");
    expect(got).not.toBeNull();
    expect(got!.alias).toBe("demo");
    expect(got!.siteurl).toBe("https://example.com");

    const list = await store.list();
    expect(list).toHaveLength(1);
  });

  it("overwrites on second set with same alias", async () => {
    await store.set({
      alias: "demo",
      siteurl: "https://a.com",
      credential_ref: "a.com",
    });
    await store.set({
      alias: "demo",
      siteurl: "https://b.com",
      credential_ref: "b.com",
    });
    const got = await store.get("demo");
    expect(got!.siteurl).toBe("https://b.com");
    expect(await store.list()).toHaveLength(1);
  });

  it("remove returns true when alias existed, false otherwise", async () => {
    await store.set({
      alias: "demo",
      siteurl: "https://a.com",
      credential_ref: "a.com",
    });
    expect(await store.remove("demo")).toBe(true);
    expect(await store.remove("demo")).toBe(false);
    expect(await store.list()).toHaveLength(0);
  });

  it("touch updates last_used_at without losing the entry", async () => {
    await store.set({
      alias: "demo",
      siteurl: "https://a.com",
      credential_ref: "a.com",
    });
    await store.touch("demo");
    const got = await store.get("demo");
    expect(got!.last_used_at).toBeDefined();
  });

  it("rejects an invalid alias name on set", async () => {
    await expect(
      store.set({
        alias: "1bad",
        siteurl: "https://a.com",
        credential_ref: "a.com",
      }),
    ).rejects.toThrow();
  });

  // Cleanup
  it("cleanup tmp", () => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
