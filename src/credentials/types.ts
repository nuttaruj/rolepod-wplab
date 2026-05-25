export interface Credential {
  /** Canonical hostname, e.g. "walnutztudio.com" (lowercase, no scheme, no port). */
  site: string
  /** WP user login (not email). */
  username: string
  /** WP Application Password. Never logged. Never serialized to artifacts. */
  appPassword: string
  /** ISO 8601. */
  addedAt: string
  /** ISO 8601, optional — runtime updates via `touch`. */
  lastUsedAt?: string
}

/**
 * Metadata-only view of a credential — safe to log, serialize, surface to
 * Lead. Contains no secrets.
 */
export interface CredentialMeta {
  site: string
  username: string
  addedAt: string
  lastUsedAt?: string
  source: 'keychain' | 'file'
}

export interface Vault {
  add(c: Credential): Promise<void>
  /** Returns the credential including raw secret. Use only inside runtime auth. */
  get(site: string): Promise<Credential | null>
  list(): Promise<CredentialMeta[]>
  remove(site: string): Promise<boolean>
  /** Update lastUsedAt without touching the secret. */
  touch(site: string): Promise<void>
}

/**
 * Normalize a user-typed URL or hostname to a canonical lowercase hostname.
 *
 *   "https://Walnutztudio.com/"   → "walnutztudio.com"
 *   "https://Sub.Site.com:443/p"  → "sub.site.com"
 *   "site.com"                     → "site.com"
 *   "http://site.com"              → "site.com"  (scheme dropped for storage key,
 *                                                 but RestTarget refuses http:// at connect time)
 */
export function canonicalizeSite(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('site cannot be empty')
  // If it parses as a URL, take hostname; otherwise treat the input as a bare hostname.
  let host: string
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
    host = u.hostname
  } catch {
    throw new Error(`invalid site: ${input}`)
  }
  return host.toLowerCase()
}
