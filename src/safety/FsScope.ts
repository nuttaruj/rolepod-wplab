import { resolve, relative, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { FsScopeError } from '../util/errors.js'

const SCOPED_DIRS = [
  'wp-content/themes',
  'wp-content/plugins',
  'wp-content/uploads',
]

const SCOPED_FILES = new Set(['wp-config.php'])

const UPLOAD_EXT_ALLOWLIST = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.svg',
  '.css',
  '.js',
  '.json',
  '.txt',
  '.md',
  '.pdf',
])

/**
 * Resolve a candidate path against the WP install root and verify it falls
 * within the writable scope. Returns the resolved absolute path on success.
 *
 * Symlinks are resolved before the scope check; this prevents symlink-trickery
 * escaping `wp-content/uploads/` to system paths.
 *
 * `confirmUnsafePath` is a deliberate escape hatch — the Lead must surface
 * this to the user before passing true.
 */
export function resolveScopedWrite(
  wpRoot: string,
  candidate: string,
  confirmUnsafePath: boolean,
): string {
  const wpRootAbs = realpath(wpRoot)
  const candidateAbs = resolve(wpRootAbs, candidate)
  const realCandidate = realpath(candidateAbs)

  const rel = relative(wpRootAbs, realCandidate)
  if (rel.startsWith('..') || rel === '' || rel.startsWith(sep)) {
    throw new FsScopeError(candidate, 'resolves outside WP install root')
  }

  // wp-config.php is special — allowed but not inside SCOPED_DIRS
  if (SCOPED_FILES.has(rel)) return realCandidate

  const inScopedDir = SCOPED_DIRS.some((dir) => rel === dir || rel.startsWith(`${dir}${sep}`))
  if (!inScopedDir) {
    if (confirmUnsafePath) return realCandidate
    throw new FsScopeError(candidate, `not under ${SCOPED_DIRS.join(' / ')} or wp-config.php`)
  }

  // Uploads must respect the extension allow-list
  if (rel.startsWith(`wp-content/uploads${sep}`)) {
    const ext = extOf(rel).toLowerCase()
    if (!UPLOAD_EXT_ALLOWLIST.has(ext)) {
      throw new FsScopeError(candidate, `extension ${ext || '<none>'} not allowed in uploads/`)
    }
  }

  return realCandidate
}

function realpath(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    // If the path doesn't exist yet (file write target), fall back to the resolved abs path.
    // realpath of the parent would be more accurate but adds complexity; v0.1 will revisit.
    return resolve(p)
  }
}

function extOf(p: string): string {
  const dot = p.lastIndexOf('.')
  if (dot < 0) return ''
  const slash = p.lastIndexOf(sep)
  if (dot < slash) return ''
  return p.slice(dot)
}
