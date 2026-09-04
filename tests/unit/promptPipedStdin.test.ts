import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

/**
 * Regression guard for the silent-exit bug: `credentials add` and `init` ask
 * several questions in a row, and a piped stdin answered only the first one.
 * A fresh readline interface per prompt swallowed the whole buffer and threw
 * away the unread lines on close(), so the second question never settled and
 * node exited 0 without storing anything.
 */

function pipedStdin(data: string): Readable & { isTTY: boolean } {
  const stream = Readable.from([Buffer.from(data, "utf8")]) as Readable & {
    isTTY: boolean;
  };
  stream.isTTY = false;
  return stream;
}

async function loadPrompt(input: string): Promise<{
  ask: (q: string) => Promise<string>;
  askSecret: (q: string) => Promise<string>;
  confirm: (q: string) => Promise<boolean>;
  written: string[];
}> {
  const written: string[] = [];
  vi.resetModules();
  vi.doMock("node:process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:process")>();
    return {
      ...actual,
      stdin: pipedStdin(input),
      stdout: {
        write: (chunk: string): boolean => {
          written.push(chunk);
          return true;
        },
      },
    };
  });
  const mod = await import("../../src/credentials/prompt.js");
  return {
    ask: mod.ask,
    askSecret: mod.askSecret,
    confirm: mod.confirm,
    written,
  };
}

describe("prompts over piped (non-TTY) stdin", () => {
  it("answers a sequence of prompts, not just the first", async () => {
    const { ask } = await loadPrompt("bob\nhunter2\n");
    expect(await ask("Username: ")).toBe("bob");
    expect(await ask("Password: ")).toBe("hunter2");
  });

  it("feeds askSecret from the same stream after an ask", async () => {
    const { ask, askSecret } = await loadPrompt(
      "walnutztudio\nabcd EFGH 1234\n",
    );
    expect(await ask("Username: ")).toBe("walnutztudio");
    expect(await askSecret("Application Password: ")).toBe("abcd EFGH 1234");
  });

  it("does not echo the secret it read", async () => {
    const { ask, askSecret, written } = await loadPrompt("bob\ns3cr3t\n");
    await ask("Username: ");
    await askSecret("Application Password: ");
    expect(written.join("")).not.toContain("s3cr3t");
  });

  it("still writes each question so piped runs stay readable", async () => {
    const { ask, written } = await loadPrompt("bob\nhunter2\n");
    await ask("Username: ");
    await ask("Password: ");
    expect(written.join("")).toContain("Username: ");
    expect(written.join("")).toContain("Password: ");
  });

  it("returns empty string when stdin runs out instead of hanging", async () => {
    const { ask } = await loadPrompt("only-one-line\n");
    expect(await ask("First: ")).toBe("only-one-line");
    expect(await ask("Second: ")).toBe("");
    expect(await ask("Third: ")).toBe("");
  });

  it("trims each answer", async () => {
    const { ask } = await loadPrompt("  spaced  \n\ttabbed\t\n");
    expect(await ask("a: ")).toBe("spaced");
    expect(await ask("b: ")).toBe("tabbed");
  });

  it("handles CRLF-terminated input", async () => {
    const { ask } = await loadPrompt("bob\r\nhunter2\r\n");
    expect(await ask("Username: ")).toBe("bob");
    expect(await ask("Password: ")).toBe("hunter2");
  });

  it("drives confirm() through the same drained stream", async () => {
    const { ask, confirm } = await loadPrompt("site.com\ny\n");
    expect(await ask("Site: ")).toBe("site.com");
    expect(await confirm("Overwrite?")).toBe(true);
  });

  it("treats a missing confirm answer as no", async () => {
    const { ask, confirm } = await loadPrompt("site.com\n");
    await ask("Site: ");
    expect(await confirm("Overwrite?")).toBe(false);
  });
});
