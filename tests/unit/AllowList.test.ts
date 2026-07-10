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

describe("AllowList — v1.2 consolidated additions", () => {
  it.each([
    ["core is-installed", ["core", "is-installed", "--network"]],
    ["core verify-checksums", ["core", "verify-checksums"]],
    ["plugin verify-checksums", ["plugin", "verify-checksums", "akismet"]],
    ["plugin get", ["plugin", "get", "akismet"]],
    ["theme get", ["theme", "get", "twentytwentyfour"]],
    ["maintenance-mode status", ["maintenance-mode", "status"]],
    ["role list", ["role", "list"]],
    ["cap list", ["cap", "list", "editor"]],
    ["term list", ["term", "list", "category"]],
    ["comment get", ["comment", "get", "3"]],
    ["user list-caps", ["user", "list-caps", "2"]],
  ])("classifies `%s` as read-only", (_label, args) => {
    expect(checkWpCli(args, false)).toEqual({
      allowed: true,
      kind: "read_only",
    });
  });

  it.each([
    ["config set", ["config", "set", "WP_DEBUG", "false", "--raw"]],
    ["config delete", ["config", "delete", "WP_DEBUG"]],
    ["core update-db", ["core", "update-db"]],
    ["theme delete", ["theme", "delete", "twentyten"]],
    ["maintenance-mode activate", ["maintenance-mode", "activate"]],
    ["maintenance-mode deactivate", ["maintenance-mode", "deactivate"]],
    ["rewrite flush", ["rewrite", "flush"]],
    ["media import", ["media", "import", "https://x.test/a.png"]],
    ["media regenerate", ["media", "regenerate"]],
    ["role create", ["role", "create", "editor2", "Editor 2"]],
    ["cap add", ["cap", "add", "editor", "manage_options"]],
    ["term create", ["term", "create", "category", "News"]],
    ["comment spam", ["comment", "spam", "3"]],
    ["user set-role", ["user", "set-role", "2", "author"]],
  ])("classifies `%s` as destructive", (_label, args) => {
    expect(checkWpCli(args, true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
    expect(checkWpCli(args, false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
  });

  it("hard-blocks `role reset` — wipes every default role's caps", () => {
    expect(checkWpCli(["role", "reset", "--all"], true)).toEqual({
      allowed: false,
      kind: "never_allowed",
    });
  });

  it("hard-blocks `db clean` — drops every prefixed table", () => {
    expect(checkWpCli(["db", "clean"], true)).toEqual({
      allowed: false,
      kind: "never_allowed",
    });
  });
});

describe("AllowList — `db query` is classified by its SQL", () => {
  it("treats a single read statement as read-only", () => {
    expect(
      checkWpCli(["db", "query", "SELECT * FROM wp_posts"], false),
    ).toEqual({ allowed: true, kind: "read_only" });
  });

  it("requires allow_destructive for a write statement", () => {
    const args = ["db", "query", "DELETE FROM wp_posts"];
    expect(checkWpCli(args, false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
    expect(checkWpCli(args, true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("never treats a stacked statement as read-only", () => {
    const args = ["db", "query", "SELECT 1; DELETE FROM wp_posts"];
    expect(checkWpCli(args, false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
    expect(checkWpCli(args, true)).toEqual({
      allowed: true,
      kind: "destructive",
    });
  });

  it("allows a semicolon inside a string literal", () => {
    expect(
      checkWpCli(
        ["db", "query", "SELECT * FROM wp_posts WHERE x = 'a;b'"],
        false,
      ),
    ).toEqual({ allowed: true, kind: "read_only" });
  });

  it("blocks `db query` with no SQL unless destructive", () => {
    expect(checkWpCli(["db", "query"], false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
  });
});

describe("AllowList — `user delete` requires --reassign", () => {
  it("blocks a bare `user delete` even with allow_destructive", () => {
    expect(checkWpCli(["user", "delete", "5"], true)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
    });
  });

  it.each([["--reassign=1"], ["--reassign"]])(
    "allows `user delete` with %s",
    (flag) => {
      expect(checkWpCli(["user", "delete", "5", flag, "1"], true)).toEqual({
        allowed: true,
        kind: "destructive",
      });
    },
  );

  it("still requires allow_destructive when reassigning", () => {
    expect(checkWpCli(["user", "delete", "5", "--reassign=1"], false)).toEqual({
      allowed: false,
      kind: "not_in_allowlist",
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
