export class WplabError extends Error {
  readonly code: string
  readonly meta: Record<string, unknown>

  constructor(code: string, message: string, meta: Record<string, unknown> = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.meta = meta
  }

  toJSON(): { code: string; message: string; meta: Record<string, unknown> } {
    return { code: this.code, message: this.message, meta: this.meta }
  }
}

export class TargetNotFoundError extends WplabError {
  constructor(targetId: string) {
    super('TARGET_NOT_FOUND', `Target ${targetId} not registered or closed`, { targetId })
  }
}

export class WpCliNotFoundError extends WplabError {
  constructor() {
    super('WPCLI_NOT_FOUND', 'wp-cli not installed or not on PATH', {})
  }
}

export class WpCliBlockedError extends WplabError {
  constructor(args: string[], reason: 'not_in_allowlist' | 'never_allowed') {
    super('WPCLI_BLOCKED', `wp-cli subcommand blocked: ${reason}`, { args, reason })
  }
}

export class FsScopeError extends WplabError {
  constructor(path: string, reason: string) {
    super('FS_SCOPE_VIOLATION', `Path outside allowed scope: ${reason}`, { path, reason })
  }
}

export class ProductionBlockedError extends WplabError {
  constructor(siteurl: string, matchedPattern: string) {
    super('PRODUCTION_BLOCKED', `Operation refused — siteurl matches production pattern`, {
      siteurl,
      matchedPattern,
    })
  }
}

export class DbWriteBlockedError extends WplabError {
  constructor(sql: string) {
    super('DB_WRITE_BLOCKED', 'DB query rejected: write not allowed without allow_write: true', {
      sql_preview: sql.slice(0, 200),
    })
  }
}

export class CompanionUnavailableError extends WplabError {
  constructor(targetId: string, detail: string) {
    super('COMPANION_UNAVAILABLE', `Companion plugin not reachable: ${detail}`, { targetId })
  }
}

export class PowerProfileRequiredError extends WplabError {
  constructor() {
    super('POWER_PROFILE_REQUIRED', 'Power profile required — set ROLEPOD_WPLAB_PROFILE=power', {})
  }
}

export class AstRejectedError extends WplabError {
  constructor(token: string, location: string) {
    super('AST_REJECTED', `Forbidden token in payload: ${token}`, { token, location })
  }
}
