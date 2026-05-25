export type TargetKind = 'local' | 'rest' | 'ssh' | 'docker'

export type CompanionStatus = {
  installed: boolean
  enabled: boolean
  version: string | null
  capabilities: readonly string[]
} | null

export interface WpCliOpts {
  allowDestructive?: boolean
  timeoutMs?: number
  cwd?: string
}

export interface WpCliResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}

export interface RestRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
  query?: Record<string, string | number | boolean>
  body?: unknown
  headers?: Record<string, string>
}

export interface RestResponse {
  status: number
  body: unknown
  headers: Record<string, string>
}

export interface FileWriteOpts {
  mode?: 'overwrite' | 'append'
  backup?: boolean
  confirmUnsafePath?: boolean
}

export interface Target {
  readonly id: string
  readonly kind: TargetKind
  readonly siteurl: string
  readonly wpVersion: string
  readonly phpVersion?: string
  readonly companion: CompanionStatus

  wpCli(args: readonly string[], opts?: WpCliOpts): Promise<WpCliResult>
  rest(req: RestRequest): Promise<RestResponse>
  fileRead(path: string): Promise<{ content: string; bytes: number; absolutePath: string }>
  fileWrite(
    path: string,
    content: string,
    opts?: FileWriteOpts,
  ): Promise<{ bytesWritten: number; backupPath: string | null; absolutePath: string }>
  fileExists(path: string): Promise<boolean>
  rootPath(): string

  // Companion-gated — v0.2+
  executePhp?(payload: string, opts: { timeoutMs?: number; confirm: true }): Promise<unknown>
  introspect?(scope: string, opts?: { includeValues?: boolean }): Promise<unknown>

  close(): Promise<void>
}
