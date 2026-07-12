import { ProdGuard } from "../../safety/ProdGuard.js";
import { assertSingleSite } from "../../safety/multisiteGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  HtaccessEditInputSchema,
  HtaccessEditOutputSchema,
  type HtaccessEditInput,
  type HtaccessEditOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpHtaccessEditToolDef = {
  name: "rolepod_wp_htaccess_edit",
  description:
    "Replace the site's root .htaccess with a safety net: write a sentinel .htaccess.bak first, write the new content, then probe the site ROOT plus one inner pretty-permalink URL (a .htaccess that dropped its RewriteRules leaves / = 200 but inner pages = 404 — a false green). If the probe fails it restores the previous content and re-probes. If even the restore can't be served (a malformed .htaccess 500s the whole Apache tree, INCLUDING the REST write path), it reports rolled_back:false and points you at .htaccess.bak to recover over SSH/filesystem. Single-site only; production writes need confirm_production=true. NOTE: on a REST-only target, auto-restore may be impossible if .htaccess breaks Apache itself.",
  inputSchema: HtaccessEditInputSchema,
};

interface Probe {
  ok: boolean;
  detail: string;
}

/**
 * Fetch the site root plus one inner pretty-permalink. A broken .htaccess (lost
 * RewriteRules) serves / but 404s inner pages, so probing only / is a false
 * green. Best-effort: an unobtainable inner link degrades to a root-only probe.
 */
async function probeSite(target: Target): Promise<Probe> {
  // Root.
  let rootStatus = 0;
  try {
    const r = await fetch(target.siteurl, { redirect: "follow" });
    rootStatus = r.status;
  } catch (err) {
    return { ok: false, detail: `root fetch threw: ${(err as Error).message}` };
  }
  if (rootStatus >= 500)
    return { ok: false, detail: `root HTTP ${rootStatus}` };

  // Inner pretty permalink (best-effort).
  let innerLink = "";
  try {
    const res = await target.rest({
      method: "GET",
      path: "/wp/v2/posts",
      query: { per_page: 1, status: "publish" },
    });
    const rows = Array.isArray(res.body)
      ? (res.body as Array<Record<string, unknown>>)
      : [];
    innerLink = String(rows[0]?.["link"] ?? "");
  } catch {
    innerLink = "";
  }
  if (innerLink && innerLink.startsWith("http")) {
    try {
      const r = await fetch(innerLink, { redirect: "follow" });
      if (r.status >= 400) {
        return {
          ok: false,
          detail: `inner permalink ${innerLink} HTTP ${r.status} (RewriteRules likely broken)`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        detail: `inner permalink fetch threw: ${(err as Error).message}`,
      };
    }
  }
  return {
    ok: true,
    detail: innerLink
      ? `root ${rootStatus}, inner permalink ok`
      : `root ${rootStatus} (no inner permalink to probe)`,
  };
}

export async function wpHtaccessEditHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<HtaccessEditOutput> {
  const input: HtaccessEditInput = HtaccessEditInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  await assertSingleSite(target);

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm_production) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "htaccess_edit blocked on production-matched target — pass confirm_production=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  // Read the current .htaccess (may not exist). It lives at ABSPATH root, which
  // is outside the FsWrite scoped dirs → confirmUnsafePath.
  let beforeContent: string | null = null;
  try {
    const r = await target.fileRead(".htaccess");
    beforeContent = r.content;
  } catch {
    beforeContent = null;
  }

  // Sentinel .htaccess.bak so a filesystem/SSH recovery is always possible even
  // if REST goes down with Apache.
  const backupPath = ".htaccess.bak";
  await target.fileWrite(backupPath, beforeContent ?? "", {
    backup: false,
    confirmUnsafePath: true,
  });

  await target.fileWrite(".htaccess", input.content, {
    backup: false,
    confirmUnsafePath: true,
  });

  const probe = await probeSite(target);
  if (probe.ok) {
    await recordChange(target, {
      category: "maintenance",
      subcategory: ".htaccess",
      targetDescriptor: "edit root .htaccess",
      beforeState: { content: beforeContent, existed: beforeContent !== null },
      afterState: { content: input.content },
      reversible: true,
      sourceTool: "wp_htaccess_edit",
    });
    return HtaccessEditOutputSchema.parse({
      written: true,
      backup_path: backupPath,
      health_ok: true,
      rolled_back: false,
    });
  }

  // Probe failed → restore the previous content (or empty if it never existed).
  try {
    await target.fileWrite(".htaccess", beforeContent ?? "", {
      backup: false,
      confirmUnsafePath: true,
    });
  } catch (err) {
    return HtaccessEditOutputSchema.parse({
      written: true,
      backup_path: backupPath,
      health_ok: false,
      rolled_back: false,
      reason: `probe failed (${probe.detail}) AND the REST restore write also failed (${(err as Error).message}) — Apache may be down. Recover over SSH/filesystem from ${backupPath}.`,
    });
  }

  const reprobe = await probeSite(target);
  if (!reprobe.ok) {
    return HtaccessEditOutputSchema.parse({
      written: true,
      backup_path: backupPath,
      health_ok: false,
      rolled_back: false,
      reason: `probe failed (${probe.detail}); restore was written but the site is STILL unhealthy (${reprobe.detail}) — a malformed .htaccess may have taken Apache down (the REST restore path 500s too). Recover over SSH/filesystem from ${backupPath}.`,
    });
  }

  return HtaccessEditOutputSchema.parse({
    written: false,
    backup_path: backupPath,
    health_ok: true,
    rolled_back: true,
    reason: `probe failed (${probe.detail}); previous .htaccess restored and re-verified`,
  });
}
