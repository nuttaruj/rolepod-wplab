type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'

const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
}

function envLevel(): LogLevel {
  const raw = (process.env['ROLEPOD_WPLAB_LOG'] ?? 'warn').toLowerCase()
  if (raw in LEVEL_RANK) return raw as LogLevel
  return 'warn'
}

let current: LogLevel = envLevel()

export function setLogLevel(level: LogLevel): void {
  current = level
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  if (LEVEL_RANK[level] > LEVEL_RANK[current]) return
  // MCP servers must NOT write to stdout — reserved for the JSON-RPC stream.
  const line = meta
    ? `[wplab][${level}] ${msg} ${JSON.stringify(meta)}`
    : `[wplab][${level}] ${msg}`
  process.stderr.write(`${line}\n`)
}

export const log = {
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
}
