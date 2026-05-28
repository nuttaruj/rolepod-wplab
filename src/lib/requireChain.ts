/**
 * Require-chain resolution for PHP file_write preflight.
 *
 * PHP `require` / `include` errors are RUNTIME, not syntax — `php -l` accepts
 * `require_once 'inc/setup.php';` even if the target file doesn't exist. When
 * that include sits in a theme bootstrap file (functions.php, header.php,
 * footer.php, mu-plugins/*.php, wp-config.php) the first page request after
 * the write produces a Fatal Error and takes the site down.
 *
 * This module scans the about-to-be-written PHP for require/include calls,
 * extracts the literal string-path argument, resolves it relative to the
 * source file's directory, and checks the target exists on the WordPress
 * server BEFORE the write commits.
 *
 * Limitations (acceptable for v1):
 *
 * - We only resolve paths whose **literal string part** can be extracted.
 *   `require_once $foo;` or `require_once get_template_directory() . $x;`
 *   are silently skipped.
 * - We resolve constant-prefix calls like
 *   `require_once WALNUTZTUDIO_DIR . '/inc/setup.php';` by treating the
 *   quoted string as a path relative to the source file's directory.
 *   This is the dominant theme-bootstrap pattern.
 * - We don't follow the include tree (don't check what inc/setup.php
 *   itself requires) — one hop is enough to catch the bug.
 */
import type { Target } from "../runtime/Target.js";

export interface RequireCheckMissing {
  required_path: string;
  resolved_path: string;
  line_hint: number | null;
}

export interface RequireCheckResult {
  scanned: number;
  missing: RequireCheckMissing[];
}

/**
 * Bootstrap files where a fatal `require` would WSOD the site. file_write
 * blocks the write when a missing require is detected against any of these.
 */
const BOOTSTRAP_RE =
  /(?:^|\/)(?:functions|header|footer|wp-config)\.php$|\/mu-plugins\/[^/]+\.php$/i;

export function isBootstrapPath(relativePath: string): boolean {
  return BOOTSTRAP_RE.test(relativePath);
}

/**
 * Pattern for require/include calls with at least one quoted string segment.
 * Captures the LAST string literal inside the call (most useful when the
 * caller concatenates a constant prefix + quoted path).
 *
 * Examples matched:
 *   require_once 'inc/setup.php';            → "inc/setup.php"
 *   require_once 'inc/setup.php' ;           → "inc/setup.php"
 *   require_once "inc/setup.php";            → "inc/setup.php"
 *   require_once WALNUTZTUDIO_DIR . '/inc/setup.php';  → "/inc/setup.php"
 *   require_once __DIR__ . "/inc/setup.php"; → "/inc/setup.php"
 *
 * Not matched (silently skipped — dynamic):
 *   require_once $foo;
 *   require_once get_template_directory() . $bar;
 *   require_once trailingslashit($x) . "lib.php";
 */
const REQUIRE_RE =
  /\b(require_once|require|include_once|include)\b[^;]*?['"]([^'"]+\.php)['"][^;]*?;/g;

/**
 * Walk all require/include statements in the source content. For each
 * resolvable target, ask the live target whether the file exists.
 *
 * @param target          Connected target with fileExists() capability.
 * @param sourcePath      Relative path of the file being written (used as
 *                        the "from" for relative-path resolution).
 * @param content         PHP source about to be written.
 */
export async function checkRequireChain(
  target: Pick<Target, "fileExists">,
  sourcePath: string,
  content: string,
): Promise<RequireCheckResult> {
  const sourceDir = parentDir(sourcePath);
  const missing: RequireCheckMissing[] = [];
  let scanned = 0;

  for (const match of content.matchAll(REQUIRE_RE)) {
    scanned++;
    const literal = match[2];
    if (!literal) continue;

    const resolved = resolveRequirePath(sourceDir, literal);
    if (!resolved) continue;

    const exists = await safeFileExists(target, resolved);
    if (exists === false) {
      missing.push({
        required_path: literal,
        resolved_path: resolved,
        line_hint: lineOf(content, match.index ?? 0),
      });
    }
  }

  return { scanned, missing };
}

/**
 * Resolve a literal require/include path string to a path relative to the
 * wp install root, using the source file's directory as the base. Returns
 * null when the literal is ambiguous (URL, contains parent traversal we
 * can't trust, absolute system path, etc).
 */
export function resolveRequirePath(
  sourceDir: string,
  literal: string,
): string | null {
  if (!literal) return null;
  if (/^https?:\/\//i.test(literal)) return null;
  // Absolute system path (starts with / and contains a host-style segment) —
  // we cannot resolve against wp-content roots reliably, skip.
  if (literal.startsWith("/home/") || literal.startsWith("/var/")) return null;

  // Treat leading `/` as "relative to source dir" when it looks like a
  // relative subpath, NOT a system absolute. This handles
  // `WALNUTZTUDIO_DIR . '/inc/setup.php'` where `__DIR__` constant prefixes
  // the literal with the directory.
  const trimmed = literal.replace(/^\.\//, "").replace(/^\//, "");

  // Collapse any `..` and `.` segments safely.
  const parts: string[] = [];
  for (const seg of `${sourceDir}/${trimmed}`.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

function parentDir(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

async function safeFileExists(
  target: Pick<Target, "fileExists">,
  path: string,
): Promise<boolean | null> {
  try {
    return await target.fileExists(path);
  } catch {
    return null;
  }
}
