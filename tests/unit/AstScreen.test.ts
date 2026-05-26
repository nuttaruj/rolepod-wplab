import { describe, expect, it } from "vitest";
import {
  screenPhpPayload,
  assertPhpPayloadOk,
} from "../../src/safety/AstScreen.js";
import { AstRejectedError } from "../../src/util/errors.js";

describe("AstScreen", () => {
  it("allows simple expressions", () => {
    expect(screenPhpPayload("return 1 + 1;").ok).toBe(true);
    expect(screenPhpPayload('return get_option("siteurl");').ok).toBe(true);
    expect(
      screenPhpPayload("$x = wp_get_current_user(); return $x->ID;").ok,
    ).toBe(true);
  });

  it("rejects empty / whitespace", () => {
    expect(screenPhpPayload("").ok).toBe(false);
    expect(screenPhpPayload("   ").ok).toBe(false);
  });

  it("rejects eval()", () => {
    const r = screenPhpPayload('eval("1+1");');
    expect(r.ok).toBe(false);
    expect(r.token).toBe("eval");
  });

  it("rejects assert()", () => {
    expect(screenPhpPayload("assert(\"system('rm')\");").ok).toBe(false);
  });

  it("rejects system / exec / shell_exec / passthru / proc_open / popen", () => {
    for (const fn of [
      "system",
      "exec",
      "shell_exec",
      "passthru",
      "proc_open",
      "popen",
    ]) {
      expect(screenPhpPayload(`${fn}("ls");`).ok).toBe(false);
    }
  });

  it("rejects backtick shell-exec syntax", () => {
    const r = screenPhpPayload("$x = `ls -la`;");
    expect(r.ok).toBe(false);
    expect(r.token).toBe("`");
  });

  it("rejects pcntl_exec / pcntl_fork / dl", () => {
    expect(screenPhpPayload('pcntl_exec("/bin/sh", []);').ok).toBe(false);
    expect(screenPhpPayload("pcntl_fork();").ok).toBe(false);
    expect(screenPhpPayload('dl("evil.so");').ok).toBe(false);
  });

  it("rejects dynamic include/require", () => {
    expect(screenPhpPayload("include $varPath;").ok).toBe(false);
    expect(screenPhpPayload("require_once($x);").ok).toBe(false);
  });

  it("allows static-string include/require", () => {
    // Note: in v0.2 token-blocklist, even static include is currently rejected
    // since our regex isn't AST-aware enough. We accept this conservative
    // posture — users wanting static include should use wp_file_write to
    // produce a separate plugin file.
    // Adjust test if v0.3 swaps to a real AST parser and unblocks static include.
    expect(screenPhpPayload('include "wp-load.php";').ok).toBe(true);
  });

  it("does not false-positive on tokens inside string literals", () => {
    expect(screenPhpPayload('return "the eval() word";').ok).toBe(true);
    expect(screenPhpPayload("return 'shell_exec is a string';").ok).toBe(true);
  });

  it("does not false-positive on tokens inside comments", () => {
    expect(screenPhpPayload("/* call eval() later */ return 1;").ok).toBe(true);
    expect(screenPhpPayload("// system() is bad\nreturn 1;").ok).toBe(true);
  });

  it("assertPhpPayloadOk throws AstRejectedError on bad input", () => {
    expect(() => assertPhpPayloadOk('system("ls");', "execute_php")).toThrow(
      AstRejectedError,
    );
    expect(() => assertPhpPayloadOk("return 1;", "execute_php")).not.toThrow();
  });

  it("case-insensitive function-name match", () => {
    expect(screenPhpPayload('SYSTEM("ls");').ok).toBe(false);
    expect(screenPhpPayload('System("ls");').ok).toBe(false);
    expect(screenPhpPayload('ShEll_ExEc("ls");').ok).toBe(false);
  });
});
