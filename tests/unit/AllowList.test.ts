import { describe, expect, it } from "vitest";
import { checkWpCli, _exposed_for_tests } from "../../src/safety/AllowList.js";

describe("AllowList — v1.0 baseline", () => {
  it("allows read-only subcommands without destructive flag", () => {
    const v = checkWpCli(["plugin", "list"], false);
    expect(v).toEqual({ allowed: true, kind: "read_only" });
  });

  it("blocks destructive subcommand when allow_destructive=false", () => {
    const v = checkWpCli(["plugin", "install", "foo"], false);
    expect(v).toEqual({ allowed: false, kind: "not_in_allowlist" });
  });

  it("allows destructive subcommand when allow_destructive=true", () => {
    const v = checkWpCli(["plugin", "install", "foo"], true);
    expect(v).toEqual({ allowed: true, kind: "destructive" });
  });

  it("hard-blocks never-allowed regardless of allow_destructive", () => {
    const v = checkWpCli(["db", "reset"], true);
    expect(v).toEqual({ allowed: false, kind: "never_allowed" });
  });

  it("hard-blocks raw `eval` even with destructive flag", () => {
    const v = checkWpCli(["eval", "$x=1;"], true);
    expect(v).toEqual({ allowed: false, kind: "never_allowed" });
  });
});

describe("AllowList — v1.1 additions", () => {
  it("allows `transient list` as read-only", () => {
    const v = checkWpCli(["transient", "list"], false);
    expect(v.allowed).toBe(true);
    expect(v).toEqual({ allowed: true, kind: "read_only" });
  });

  it("allows `user session list` as read-only", () => {
    const v = checkWpCli(["user", "session", "list"], false);
    expect(v).toEqual({ allowed: true, kind: "read_only" });
  });

  it("allows `cache type` as read-only", () => {
    const v = checkWpCli(["cache", "type"], false);
    expect(v).toEqual({ allowed: true, kind: "read_only" });
  });

  it("classifies `cron event run <hook>` as destructive", () => {
    expect(checkWpCli(["cron", "event", "run", "my_hook"], false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
    expect(checkWpCli(["cron", "event", "run", "my_hook"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("classifies `cache flush` as destructive", () => {
    expect(checkWpCli(["cache", "flush"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
    expect(checkWpCli(["cache", "flush"], false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
  });

  it("classifies `db export` as destructive (writes file)", () => {
    expect(checkWpCli(["db", "export", "foo.sql"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("classifies `search-replace` as destructive (single token)", () => {
    expect(checkWpCli(["search-replace", "old.com", "new.com"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("allows `wpml post update` via namespaced single-token destructive", () => {
    expect(checkWpCli(["wpml", "post", "update", "5"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("allows `gf entry delete` via namespaced single-token destructive", () => {
    expect(checkWpCli(["gf", "entry", "delete", "42"], true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });
});

describe("AllowList — internal sets exposed for tests", () => {
  it("READ_ONLY contains expected v1.1 entries", () => {
    expect(_exposed_for_tests.READ_ONLY.has("transient list")).toBe(true);
    expect(_exposed_for_tests.READ_ONLY.has("user session list")).toBe(true);
    expect(_exposed_for_tests.READ_ONLY.has("cache type")).toBe(true);
  });

  it("DESTRUCTIVE contains expected v1.1 entries", () => {
    expect(_exposed_for_tests.DESTRUCTIVE.has("cron event run")).toBe(true);
    expect(_exposed_for_tests.DESTRUCTIVE.has("cache flush")).toBe(true);
    expect(_exposed_for_tests.DESTRUCTIVE.has("transient delete")).toBe(true);
    expect(_exposed_for_tests.DESTRUCTIVE.has("search-replace")).toBe(true);
    expect(_exposed_for_tests.DESTRUCTIVE.has("wpml")).toBe(true);
    expect(_exposed_for_tests.DESTRUCTIVE.has("gf")).toBe(true);
  });

  it("NEVER_ALLOWED remains hard-blocked", () => {
    expect(_exposed_for_tests.NEVER_ALLOWED.has("db reset")).toBe(true);
    expect(_exposed_for_tests.NEVER_ALLOWED.has("eval")).toBe(true);
  });
});
