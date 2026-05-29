import { z } from "zod";
import { ProdGuard } from "../../safety/ProdGuard.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const ChildThemeCreateInputSchema = z.object({
  target_id: z.string(),
  parent_slug: z.string().min(1),
  child_slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, "child_slug must be lowercase letters/digits/_-"),
  name: z.string().optional(),
  description: z.string().optional(),
});

export const wpChildThemeCreateToolDef = {
  name: "rolepod_wp_child_theme_create",
  description:
    "Scaffold a child theme of the named parent. Reads parent style.css to copy Theme Name + Version into the child header. Emits style.css (with Template: <parent>) + functions.php (parent-style enqueue). Use this BEFORE editing an installed parent theme — keeps the parent clean across updates. Each file is recorded in the Change Ledger so the whole scaffold is revertable as a session.",
  inputSchema: ChildThemeCreateInputSchema,
};

export async function wpChildThemeCreateHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<{
  parent_slug: string;
  child_slug: string;
  files_written: Array<{ path: string; bytes: number }>;
}> {
  const input = ChildThemeCreateInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  prodGuard.enforce(target.siteurl);

  // 1. Read parent style.css for Theme Name + Version (best-effort).
  const parentStylePath = `wp-content/themes/${input.parent_slug}/style.css`;
  let parentName = input.parent_slug;
  let parentVersion = "1.0.0";
  try {
    const r = await target.fileRead(parentStylePath);
    const nameMatch = r.content.match(/Theme Name:\s*(.+)/i);
    const versionMatch = r.content.match(/Version:\s*(.+)/i);
    if (nameMatch?.[1]) parentName = nameMatch[1].trim();
    if (versionMatch?.[1]) parentVersion = versionMatch[1].trim();
  } catch (err) {
    throw new WplabError(
      "CHILD_THEME_PARENT_NOT_FOUND",
      `cannot read parent style.css at ${parentStylePath}: ${(err as Error).message}`,
      { parent_slug: input.parent_slug },
    );
  }

  const childName = input.name ?? `${parentName} — Rolepod child`;
  const childDescription =
    input.description ??
    `Child theme of ${parentName}, scaffolded by rolepod-wplab.`;

  // 2. Refuse if child already exists.
  const childRootStyle = `wp-content/themes/${input.child_slug}/style.css`;
  try {
    await target.fileRead(childRootStyle);
    // If read succeeded, child exists.
    throw new WplabError(
      "CHILD_THEME_ALREADY_EXISTS",
      `child theme ${input.child_slug} already exists at ${childRootStyle}`,
      { child_slug: input.child_slug },
    );
  } catch (err) {
    if ((err as WplabError).code === "CHILD_THEME_ALREADY_EXISTS") throw err;
    /* expected — child does not exist */
  }

  // 3. Compose style.css.
  const styleCss = `/*
Theme Name: ${childName}
Template: ${input.parent_slug}
Description: ${childDescription}
Author: rolepod-wplab
Version: ${parentVersion}-child
Tags: rolepod
Text Domain: ${input.child_slug}
*/
`;

  // 4. Compose functions.php — enqueues parent stylesheet so the child inherits.
  const functionsPhp = `<?php
/**
 * ${childName} — child theme functions
 * Scaffolded by rolepod-wplab. Add custom hooks + callbacks below the line.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('wp_enqueue_scripts', static function (): void {
    wp_enqueue_style(
        '${input.parent_slug}-parent-style',
        get_template_directory_uri() . '/style.css',
        [],
        wp_get_theme(get_template())->get('Version')
    );
}, 10);

// ─── Custom callbacks go below ──────────────────────────────────────────
`;

  // 5. Write both files via the standard wp_file_write path so they get
  //    auto-validation, backup, and ledger records.
  const childStylePath = `wp-content/themes/${input.child_slug}/style.css`;
  const childFunctionsPath = `wp-content/themes/${input.child_slug}/functions.php`;

  const styleResult = await target.fileWrite(childStylePath, styleCss, {
    mode: "overwrite",
    backup: false, // new file — nothing to back up
  });
  const fnResult = await target.fileWrite(childFunctionsPath, functionsPhp, {
    mode: "overwrite",
    backup: false,
  });

  return {
    parent_slug: input.parent_slug,
    child_slug: input.child_slug,
    files_written: [
      { path: childStylePath, bytes: styleResult.bytesWritten },
      { path: childFunctionsPath, bytes: fnResult.bytesWritten },
    ],
  };
}
