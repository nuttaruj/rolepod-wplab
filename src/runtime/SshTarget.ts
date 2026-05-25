import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { NodeSSH } from 'node-ssh'
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

export interface SshTargetOptions {
  host: string
  user: string
  port?: number
  privateKeyPath?: string
  password?: string
  wpPath: string
}

/**
 * SshTarget — remote WordPress over SSH. Runs wp-cli on the remote host via
 * exec(); file ops via SFTP. REST not implemented here (use RestTarget
 * separately if the same site needs REST + SSH simultaneously).
 *
 * v0.3 minimum: wpCli + fileRead + fileWrite. companion handshake is left
 * for v0.3.1 — needs HTTPS + App Password path orthogonal to SSH.
 */
export class SshTarget implements Target {
  readonly id: string
  readonly kind = 'ssh' as const
  readonly siteurl: string
  readonly wpVersion: string
  readonly phpVersion?: string
  readonly companion: CompanionStatus = null

  private readonly _ssh: NodeSSH
  private readonly _wpPath: string

  private constructor(args: {
    id: string
    ssh: NodeSSH
    wpPath: string
    siteurl: string
    wpVersion: string
    phpVersion?: string
  }) {
    this.id = args.id
    this._ssh = args.ssh
    this._wpPath = args.wpPath
    this.siteurl = args.siteurl
    this.wpVersion = args.wpVersion
    if (args.phpVersion !== undefined) this.phpVersion = args.phpVersion
  }

  static async open(opts: SshTargetOptions): Promise<SshTarget> {
    const ssh = new NodeSSH()
    const connectArgs: Record<string, unknown> = {
      host: opts.host,
      username: opts.user,
      port: opts.port ?? 22,
    }
    if (opts.privateKeyPath) {
      connectArgs['privateKey'] = await readFile(opts.privateKeyPath, 'utf8')
    } else if (opts.password) {
      connectArgs['password'] = opts.password
    } else {
      throw new WplabError('SSH_NO_AUTH', 'SshTarget requires privateKeyPath or password', {})
    }
    await ssh.connect(connectArgs)

    // Probe wp version + siteurl
    const version = await ssh.execCommand(`wp --path=${escapeArg(opts.wpPath)} core version --no-color`)
    if (version.code !== 0) {
      ssh.dispose()
      throw new WplabError('SSH_WP_PROBE_FAILED', `wp core version exit ${version.code}: ${version.stderr.slice(0, 200)}`, {
        host: opts.host,
      })
    }
    const siteurlOut = await ssh.execCommand(`wp --path=${escapeArg(opts.wpPath)} option get siteurl --no-color`)

    log.info('SshTarget opened', { host: opts.host, wpPath: opts.wpPath })

    return new SshTarget({
      id: makeTargetId(),
      ssh,
      wpPath: opts.wpPath,
      siteurl: siteurlOut.stdout.trim() || `ssh://${opts.host}${opts.wpPath}`,
      wpVersion: version.stdout.trim(),
    })
  }

  rootPath(): string {
    return this._wpPath
  }

  async wpCli(args: readonly string[], _opts?: WpCliOpts): Promise<WpCliResult> {
    const cmdParts = ['wp', `--path=${escapeArg(this._wpPath)}`, '--no-color']
    for (const a of args) cmdParts.push(escapeArg(a))
    const cmd = cmdParts.join(' ')
    const t0 = Date.now()
    const result = await this._ssh.execCommand(cmd, {
      execOptions: { env: { WP_CLI_DISABLE_AUTO_CHECK_UPDATE: '1' } },
    })
    return {
      exitCode: result.code ?? -1,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      durationMs: Date.now() - t0,
    }
  }

  async rest(_req: RestRequest): Promise<RestResponse> {
    throw new WplabError(
      'NOT_IMPLEMENTED',
      'SshTarget.rest() not implemented — use RestTarget for HTTP+App Password against the same site',
      {},
    )
  }

  async fileRead(path: string): Promise<{ content: string; bytes: number; absolutePath: string }> {
    const abs = `${this._wpPath}/${path}`
    const tmp = `/tmp/wplab-${randomBytes(4).toString('hex')}`
    await this._ssh.getFile(tmp, abs)
    const fs = await import('node:fs/promises')
    const content = await fs.readFile(tmp, 'utf8')
    await fs.unlink(tmp).catch(() => undefined)
    return { content, bytes: Buffer.byteLength(content, 'utf8'), absolutePath: abs }
  }

  async fileWrite(
    path: string,
    content: string,
    _opts: FileWriteOpts = {},
  ): Promise<{ bytesWritten: number; backupPath: string | null; absolutePath: string }> {
    const abs = `${this._wpPath}/${path}`
    const tmp = `/tmp/wplab-${randomBytes(4).toString('hex')}`
    const fs = await import('node:fs/promises')
    await fs.writeFile(tmp, content, 'utf8')
    await this._ssh.putFile(tmp, abs)
    await fs.unlink(tmp).catch(() => undefined)
    return { bytesWritten: Buffer.byteLength(content, 'utf8'), backupPath: null, absolutePath: abs }
  }

  async fileExists(path: string): Promise<boolean> {
    const abs = `${this._wpPath}/${path}`
    const r = await this._ssh.execCommand(`test -f ${escapeArg(abs)} && echo yes`)
    return r.stdout.trim() === 'yes'
  }

  async close(): Promise<void> {
    this._ssh.dispose()
    log.info('SshTarget closed', { id: this.id })
  }
}

function makeTargetId(): string {
  return `tgt_${randomBytes(6).toString('hex')}`
}

function escapeArg(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
