import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { FormsEngine } from "./read.js";

/** Only Gravity Forms exposes a safe wp-cli entry API. CF7/WPForms (and Fluent/
 *  Ninja/Formidable) have no verified write surface — refuse LOUDLY rather than
 *  guess their storage, which is the wrong-data bug class the audit closes. */
function assertGravity(engine: FormsEngine, op: string): void {
  if (engine !== "gravity") {
    throw new WplabError(
      "FORMS_ENGINE_UNSUPPORTED_WRITE",
      `${op} is only supported for Gravity Forms (got "${engine}"). CF7 / WPForms / other engines have no verified write API here — edit the entry in the plugin's own UI.`,
      { engine, op, supported: ["gravity"] },
    );
  }
}

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
    target.kind !== "docker" &&
    !(target.kind === "rest" && target.companion?.enabled)
  ) {
    throw new Error(
      "forms write requires shell-capable target OR RestTarget with companion (Gravity Forms CLI).",
    );
  }
}

export const formsWrite: FormsWriteAPI = {
  async deleteEntry(target, engine, entryId) {
    assertGravity(engine, "delete_entry");
    requireShell(target);
    const r = await target.wpCli(["gf", "entry", "delete", String(entryId)], {
      allowDestructive: true,
    });
    if (r.exitCode !== 0)
      throw new Error(`gf entry delete failed: ${r.stderr.slice(0, 200)}`);
    return { source: "wp_cli" };
  },

  async markSpam(target, engine, entryId) {
    assertGravity(engine, "mark_spam");
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
    assertGravity(engine, "unmark_spam");
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
