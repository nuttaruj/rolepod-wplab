import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runWpCli } from './wpCli.js'
import { readScopedFile, writeScopedFile, fileExists } from './fs.js'
import { WplabError } from '../util/errors.js'
import { log } from '../util/log.js'
import type {
  CompanionStatus,
  FileWriteOpts,
  RestRequest,
  RestResponse,
  Target,
  WpCliOpts,
  WpCliResult,
} from './Target.js'

export class LocalTarget implements Target {
  readonly id: string
  readonly kind = 'local' as const
  readonly siteurl: string
  readonly wpVersion: string
  readonly phpVersion?: string
  readonly companion: CompanionStatus

  private readonly _wpRoot: string

  private constructor(args: {
    id: string
    wpRoot: string
    siteurl: string
    wpVersion: string
    phpVersion?: string
    companion: CompanionStatus
  }) {
    this.id = args.id
    this._wpRoot = args.wpRoot
    this.siteurl = args.siteurl
    this.wpVersion = args.wpVersion
    if (args.phpVersion !== undefined) this.phpVersion = args.phpVersion
    this.companion = args.companion
  }

  static async open(wpRoot: string): Promise<LocalTarget> {
    if (!existsSync(wpRoot)) {
      throw new WplabError('TARGET_PATH_MISSING', `WP root not found: ${wpRoot}`, { wpRoot })
    }
    if (!existsSync(join(wpRoot, 'wp-config.php')) && !existsSync(join(wpRoot, 'wp-load.php'))) {
      throw new WplabError(
        'TARGET_NOT_A_WP_INSTALL',
        `Path does not look like a WP install (no wp-config.php or wp-load.php): ${wpRoot}`,
        { wpRoot },
      )
    }

    const [versionResult, siteurlResult, phpVersionResult] = await Promise.all([
      runWpCli(wpRoot, ['core', 'version']),
      runWpCli(wpRoot, ['option', 'get', 'siteurl']),
      runWpCli(wpRoot, ['eval', 'echo phpversion();']).catch(() => null),
    ])

    const wpVersion = versionResult.stdout.trim() || 'unknown'
    const siteurl = siteurlResult.stdout.trim() || `file://${wpRoot}`

    log.info('LocalTarget connected', { wpRoot, wpVersion, siteurl })

    // v0.0 — companion always reported absent; v0.1 will probe REST handshake here.
    return new LocalTarget({
      id: makeTargetId(),
      wpRoot,
      siteurl,
      wpVersion,
      ...(phpVersionResult?.stdout.trim()
        ? { phpVersion: phpVersionResult.stdout.trim() }
        : {}),
      companion: null,
    })
  }

  rootPath(): string {
    return this._wpRoot
  }

  async wpCli(args: readonly string[], opts?: WpCliOpts): Promise<WpCliResult> {
    return runWpCli(this._wpRoot, args, opts ?? {})
  }

  async rest(_req: RestRequest): Promise<RestResponse> {
    // v0.0 — REST client lives in v0.1. We keep the method to satisfy the interface
    // and to make the v0.1 upgrade additive instead of API-breaking.
    throw new WplabError('NOT_IMPLEMENTED', 'rest() lands in v0.1', {})
  }

  async fileRead(
    path: string,
  ): Promise<{ content: string; bytes: number; absolutePath: string }> {
    return readScopedFile(this._wpRoot, path)
  }

  async fileWrite(
    path: string,
    content: string,
    opts: FileWriteOpts = {},
  ): Promise<{ bytesWritten: number; backupPath: string | null; absolutePath: string }> {
    return writeScopedFile(this._wpRoot, path, content, opts)
  }

  async fileExists(path: string): Promise<boolean> {
    return fileExists(join(this._wpRoot, path))
  }

  async close(): Promise<void> {
    log.info('LocalTarget closed', { id: this.id })
  }
}

function makeTargetId(): string {
  return `tgt_${randomBytes(6).toString('hex')}`
}
