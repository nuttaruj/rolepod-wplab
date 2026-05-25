import { AstRejectedError } from '../util/errors.js'

/**
 * Token-blocklist AST screen for PHP payloads (Node side, v0.2).
 *
 * Mirrors the companion v0.1 PHP-side screen (defence in depth). v0.3 will
 * upgrade to a real PHP AST via the `php-parser` npm package.
 *
 * Strategy:
 *   1. Reject backtick-shell-exec syntax via regex.
 *   2. Tokenize words; reject any forbidden function name followed by `(`.
 *   3. Reject `eval`, `assert`, language constructs.
 *   4. Reject dynamic include/require (anything that isn't a static string lit).
 */
const FORBIDDEN_FUNCTIONS = [
  'eval',
  'assert',
  'create_function',
  'system',
  'passthru',
  'shell_exec',
  'exec',
  'proc_open',
  'popen',
  'pcntl_exec',
  'pcntl_fork',
  'dl',
]

const FORBIDDEN_KEYWORDS = ['include', 'include_once', 'require', 'require_once']

export interface AstScreenResult {
  ok: boolean
  reason?: string
  token?: string
}

export function screenPhpPayload(payload: string): AstScreenResult {
  if (typeof payload !== 'string' || payload.trim() === '') {
    return { ok: false, reason: 'empty payload' }
  }

  // Strip string literals + comments so all checks ignore tokens inside them.
  const stripped = stripStringsAndComments(payload)

  // 1. Backtick exec (against stripped — avoid backticks inside strings)
  if (/`[^`]*`/.test(stripped)) {
    return { ok: false, reason: 'backtick shell-exec syntax forbidden', token: '`' }
  }

  // 2. Function-call check: word followed by (
  const callPattern = /\b([a-z_][a-z0-9_]*)\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = callPattern.exec(stripped)) !== null) {
    const fn = match[1]!.toLowerCase()
    if (FORBIDDEN_FUNCTIONS.includes(fn)) {
      return { ok: false, reason: `forbidden function call: ${fn}()`, token: fn }
    }
  }

  // 3. Language construct check: include / require followed by anything
  //    other than a quoted string literal. Static string include is allowed.
  //    Run against ORIGINAL payload (need quote chars) but skip matches
  //    that fall inside comments/strings.
  for (const kw of FORBIDDEN_KEYWORDS) {
    const re = new RegExp(`\\b${kw}\\b\\s*\\(?\\s*(['"])?`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(payload)) !== null) {
      if (isInsideStringOrComment(payload, m.index)) continue
      const next = m[1]
      if (next !== "'" && next !== '"') {
        return { ok: false, reason: `dynamic include/require forbidden`, token: kw }
      }
    }
  }

  // 4. Bare eval keyword — check stripped
  if (/\beval\s*\(/i.test(stripped)) {
    return { ok: false, reason: 'eval() is forbidden', token: 'eval' }
  }

  return { ok: true }
}

/** Cheap walker: is `idx` inside a string literal or comment in `src`? */
function isInsideStringOrComment(src: string, idx: number): boolean {
  let i = 0
  while (i < idx) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) return idx >= i
      if (idx >= i && idx < end + 2) return true
      i = end + 2
      continue
    }
    if ((ch === '/' && next === '/') || ch === '#') {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      if (idx >= i && idx < stop) return true
      i = stop
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === quote) break
        j++
      }
      if (idx >= i && idx <= j) return true
      i = j + 1
      continue
    }
    i++
  }
  return false
}

/** Throws AstRejectedError if screen fails. */
export function assertPhpPayloadOk(payload: string, location: string): void {
  const r = screenPhpPayload(payload)
  if (!r.ok) {
    throw new AstRejectedError(r.token ?? 'unknown', `${location}: ${r.reason}`)
  }
}

/** Remove string-literal contents + // and /* comments. Coarse but adequate. */
function stripStringsAndComments(src: string): string {
  let s = src
  // Block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ')
  // Line comments (// and #)
  s = s.replace(/(^|[^:])(\/\/|#)[^\n]*/g, '$1')
  // Strings — replace contents with spaces, keep quote markers so structure intact
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''")
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""')
  return s
}
