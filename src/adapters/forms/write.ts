import type { Target } from "../../runtime/Target.js";
import type { FormsEngine } from "./read.js";

export interface FormsWriteAPI {
  deleteEntry(
    target: Target,
    engine: FormsEngine,
    entryId: number,
  ): Promise<{ source: "wp_cli" }>;
  markSpam(
    target: Target,
    engine: FormsEngine,
    entryId: number,
  ): Promise<{ source: "wp_cli" }>;
  unmarkSpam(
    target: Target,
    engine: FormsEngine,
    entryId: number,
  ): Promise<{ source: "wp_cli" }>;
}

function requireShell(target: Target): void {
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker"
  ) {
    throw new Error(
      "forms write requires shell-capable target (Gravity Forms CLI).",
    );
  }
}

export const formsWrite: FormsWriteAPI = {
  async deleteEntry(target, engine, entryId) {
    if (engine !== "gravity")
      throw new Error(`delete_entry only wired for Gravity (got ${engine})`);
    requireShell(target);
    const r = await target.wpCli(["gf", "entry", "delete", String(entryId)], {
      allowDestructive: true,
    });
    if (r.exitCode !== 0)
      throw new Error(`gf entry delete failed: ${r.stderr.slice(0, 200)}`);
    return { source: "wp_cli" };
  },

  async markSpam(target, engine, entryId) {
    if (engine !== "gravity")
      throw new Error(`mark_spam only wired for Gravity (got ${engine})`);
    requireShell(target);
    const r = await target.wpCli(
      ["gf", "entry", "update", String(entryId), "--status=spam"],
      { allowDestructive: true },
    );
    if (r.exitCode !== 0)
      throw new Error(`gf entry mark spam failed: ${r.stderr.slice(0, 200)}`);
    return { source: "wp_cli" };
  },

  async unmarkSpam(target, engine, entryId) {
    if (engine !== "gravity")
      throw new Error(`unmark_spam only wired for Gravity (got ${engine})`);
    requireShell(target);
    const r = await target.wpCli(
      ["gf", "entry", "update", String(entryId), "--status=active"],
      { allowDestructive: true },
    );
    if (r.exitCode !== 0)
      throw new Error(`gf entry unmark spam failed: ${r.stderr.slice(0, 200)}`);
    return { source: "wp_cli" };
  },
};
