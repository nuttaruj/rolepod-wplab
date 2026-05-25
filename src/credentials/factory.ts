import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { FileVault } from './FileVault.js'
import { KeychainVault, keychainAvailable } from './KeychainVault.js'
import type { Vault } from './types.js'

export interface VaultOptions {
  /** Force a specific vault kind. Default = auto-detect by platform. */
  kind?: 'keychain' | 'file'
  /** Override the directory holding sidecar metadata + file-vault store. */
  configDir?: string
}

/**
 * Resolve a credential vault for this OS.
 *
 *   macOS:  KeychainVault (sidecar metadata at ~/.config/rolepod-wplab/credentials-meta.json)
 *   Linux:  FileVault    (~/.config/rolepod-wplab/credentials.json, mode 0600)
 *   Win:    FileVault    (v0.1; Credential Manager integration deferred to v1.0)
 *
 * `kind: 'file'` env override exists for users who want portable JSON instead
 * of OS keychain (e.g. dotfiles repo) — accept the security trade-off
 * explicitly via env `ROLEPOD_WPLAB_VAULT=file`.
 */
export async function makeVault(opts: VaultOptions = {}): Promise<Vault> {
  const configDir = opts.configDir ?? join(homedir(), '.config', 'rolepod-wplab')
  const requestedKind =
    opts.kind ?? (process.env['ROLEPOD_WPLAB_VAULT'] as 'keychain' | 'file' | undefined)

  if (requestedKind === 'file') {
    return new FileVault(join(configDir, 'credentials.json'))
  }
  if (requestedKind === 'keychain') {
    return new KeychainVault(join(configDir, 'credentials-meta.json'))
  }

  // Auto: prefer keychain on macOS if available; otherwise file.
  if (platform() === 'darwin' && (await keychainAvailable())) {
    return new KeychainVault(join(configDir, 'credentials-meta.json'))
  }
  return new FileVault(join(configDir, 'credentials.json'))
}
