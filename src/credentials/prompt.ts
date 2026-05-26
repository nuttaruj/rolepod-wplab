import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Plain-text input from stdin (visible echo). Use for usernames + confirms.
 */
export async function ask(question: string): Promise<string> {
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
