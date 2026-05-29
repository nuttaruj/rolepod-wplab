import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import {
  decodeElementorData,
  writeElementorData,
} from "../../lib/elementorData.js";
import {
  WpElementorRestoreInputSchema,
  WpElementorRestoreOutputSchema,
  type WpElementorRestoreInput,
  type WpElementorRestoreOutput,
} from "../../schema/tools.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpElementorRestoreToolDef = {
  name: "rolepod_wp_elementor_restore",
  description:
    "List or restore `_elementor_data` backups for a post. Backups are auto-created (timestamped) by every elementor_write / elementor_section mutation under wp-content/uploads/rolepod-wp/backups/ (plus the legacy wplab-backups/). action:list returns them newest-first; action:restore writes the chosen backup back (handling the double-JSON-encoding internally), auto-backs-up the current state first, and flushes the Elementor CSS cache. Production target needs confirm=true to restore.",
  inputSchema: WpElementorRestoreInputSchema,
};

const BACKUP_DIRS = [
  "wp-content/uploads/rolepod-wp/backups/",
  "wp-content/uploads/wplab-backups/",
];

export async function wpElementorRestoreHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<WpElementorRestoreOutput> {
  const input: WpElementorRestoreInput =
    WpElementorRestoreInputSchema.parse(raw);
  const target = registry.get(input.target_id);

  if (input.action === "list") {
    const dirsLiteral = JSON.stringify(BACKUP_DIRS);
    const php =
      `$pid=${input.post_id};$dirs=${dirsLiteral};$out=[];` +
      `foreach($dirs as $d){$g=glob(ABSPATH.$d.'elementor-'.$pid.'-*.json');` +
      `if(is_array($g)){foreach($g as $f){$out[]=['path'=>$d.basename($f),'bytes'=>filesize($f),'mtime'=>filemtime($f)];}}}` +
      `usort($out,function($a,$b){return $b['mtime']-$a['mtime'];});echo json_encode($out);`;
    const r = await target.wpCli(["eval", php]);
    if (r.exitCode !== 0) {
      throw new WplabError(
        "ELEMENTOR_RESTORE_LIST_FAILED",
        `could not list backups: ${r.stderr.slice(0, 200) || r.stdout.slice(0, 200)}`,
        { post_id: input.post_id },
      );
    }
    let backups: Array<{ path: string; bytes: number; mtime: number }> = [];
    try {
      backups = JSON.parse(r.stdout.trim() || "[]");
    } catch {
      backups = [];
    }
    return WpElementorRestoreOutputSchema.parse({
      post_id: input.post_id,
      action: "list",
      backups,
    });
  }

  // ---- restore ----
  if (input.backup_path === undefined) {
    throw new WplabError(
      "ELEMENTOR_RESTORE_PATH_REQUIRED",
      "restore needs backup_path (get one from action:list)",
      {},
    );
  }
  // Only allow restoring from a known backup dir + the post's own prefix —
  // never let an arbitrary path become _elementor_data.
  const inDir = BACKUP_DIRS.some((d) => input.backup_path!.startsWith(d));
  const ownsPrefix = input.backup_path.includes(`elementor-${input.post_id}-`);
  if (!inDir || !ownsPrefix) {
    throw new WplabError(
      "ELEMENTOR_RESTORE_PATH_REJECTED",
      `backup_path must be under a backup dir and match elementor-${input.post_id}-*`,
      { backup_path: input.backup_path },
    );
  }

  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      "elementor_restore on a prod target needs confirm=true",
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  const file = await target.fileRead(input.backup_path);
  // Backup content is `wp post meta get --format=json` output = the (possibly
  // double-encoded) _elementor_data string. decodeElementorData unwraps both.
  const sections = decodeElementorData(file.content);
  const res = await writeElementorData(target, input.post_id, sections);

  return WpElementorRestoreOutputSchema.parse({
    post_id: input.post_id,
    action: "restore",
    restored_from: input.backup_path,
    bytes_written: res.bytesWritten,
    pre_restore_backup: res.backupPath,
    flushed: true,
  });
}
