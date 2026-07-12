import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WS8-T7 anti-regression guard.
 *
 * These files build execute-php payloads that embed user-controlled strings.
 * A raw `${JSON.stringify(userValue)}` interpolated into a PHP payload is an
 * RCE-class bug: JSON.stringify emits a DOUBLE-quoted PHP string, and PHP
 * interpolates `${...}` / `$var` inside double quotes — so a value like
 * `${system('id')}` executes. WS8-T6 routed every such sink through phpQuote
 * (single-quoted, no interpolation) or phpJsonArg (json_decode of a phpQuoted
 * JSON string). This guard goes RED if anyone reverts one to raw interpolation.
 *
 * NOT guarded (intentionally): src/adapters/_shared/replacePostMeta.ts — its
 * `${JSON.stringify(...)}` embeds only SERVER-generated file paths + adapter
 * meta keys, and the user VALUE is written to a file and read back via
 * file_get_contents, never interpolated into PHP source.
 */
const GUARDED_FILES = [
  "src/tools/atomic/wp_cf7_form_create.ts",
  "src/tools/atomic/wp_global_styles_set.ts",
  "src/tools/atomic/wp_seo_set.ts",
  "src/tools/atomic/wp_menu_add_item.ts",
  "src/tools/atomic/wp_menu_create.ts",
  "src/tools/atomic/wp_menu_assign.ts",
  "src/tools/atomic/wp_mail_test.ts",
  "src/tools/composite/wp_site_scaffold.ts",
];

describe("phpEmbed guard (WS8-T7)", () => {
  it.each(GUARDED_FILES)(
    "%s embeds user data via phpQuote/phpJsonArg, never raw ${JSON.stringify} interpolation",
    (rel) => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).not.toMatch(/\$\{JSON\.stringify\(/);
    },
  );

  it("every guarded file actually imports a phpEmbed helper (proves it embeds via the safe path)", () => {
    for (const rel of GUARDED_FILES) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src).toMatch(/from "\.\.\/\.\.\/lib\/phpEmbed\.js"/);
    }
  });
});
