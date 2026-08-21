import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Non-interactive stdin (a pipe, or a redirected file) is drained once, up
 * front, and then handed out one line per prompt.
 *
 * A fresh readline interface per prompt does not work here: readline reads
 * stdin in chunks, so the first interface swallows every buffered line and
 * close() discards the ones it had not yielded yet. The next interface opens
 * on an already-drained stream, its question() never settles, node sees an
 * empty event loop and exits 0 — so a multi-prompt command silently skips the
 * work it was about to do and still reports success. Draining once keeps every
 * prompt in a sequence answerable, and a missing line comes back as "" so the
 * caller's own validation reports it. TTY input is untouched.
 */
let pipedLines: string[] | null = null;
let pipedCursor = 0;

async function nextPipedLine(): Promise<string> {
  if (pipedLines === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string, "utf8"),
      );
    }
    pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  return pipedLines[pipedCursor++] ?? "";
}

/**
 * Reset the drained-stdin cache. Tests only.
 */
export function resetPipedInput(): void {
  pipedLines = null;
  pipedCursor = 0;
}

/**
 * Plain-text input from stdin (visible echo). Use for usernames + confirms.
 */
export async function ask(question: string): Promise<string> {
  if (!stdin.isTTY) {
    stdout.write(question);
    const line = (await nextPipedLine()).trim();
    stdout.write("\n");
    return line;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/**
 * Hidden-input from stdin (no echo). Use for passwords.
 *
 * Manually drains stdin in raw mode; writes the prompt to stdout but
 * suppresses keystroke echo. Backspace handled. Enter terminates.
 *
 * Falls back to plain echo if stdin is not a TTY (e.g. piped) — in that case
 * the caller is responsible for accepting echoing on non-interactive input.
 */
export async function askSecret(question: string): Promise<string> {
  if (!stdin.isTTY) {
    return ask(question);
  }

  stdout.write(question);
  const wasRaw = stdin.isRaw;
  stdin.setRawMode?.(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  return new Promise<string>((resolve, reject) => {
    let buf = "";

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        switch (ch) {
          case "\r":
          case "\n":
            cleanup();
            stdout.write("\n");
            resolve(buf);
            return;
          case "": // Ctrl-C
            cleanup();
            stdout.write("\n");
            reject(new Error("aborted by user"));
            return;
          case "": // backspace (DEL)
          case "\b":
            if (buf.length > 0) buf = buf.slice(0, -1);
            break;
          default:
            if (ch >= " ") buf += ch;
            break;
        }
      }
    };

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
    };

    stdin.on("data", onData);
  });
}

/**
 * Yes/no prompt — defaults to no.
 */
export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} [y/N] `)).toLowerCase();
  return answer === "y" || answer === "yes";
}
