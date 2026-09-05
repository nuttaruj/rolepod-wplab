import { COMPANION_INSTALL_URL } from "../companion/constants.js";

export class WplabError extends Error {
  readonly code: string;
  readonly meta: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.meta = meta;
  }

  toJSON(): { code: string; message: string; meta: Record<string, unknown> } {
    return { code: this.code, message: this.message, meta: this.meta };
  }
}

export class TargetNotFoundError extends WplabError {
  constructor(targetId: string) {
    super(
      "TARGET_NOT_FOUND",
      `Target ${targetId} not registered or closed — targets live only as long as the server process. Connect again (rolepod_wp_connect_local / _rest / _ssh / _docker) and use the new target_id.`,
      { targetId },
    );
  }
}

export class WpCliNotFoundError extends WplabError {
  constructor() {
    super("WPCLI_NOT_FOUND", "wp-cli not installed or not on PATH", {});
  }
}

export class WpCliBlockedError extends WplabError {
  constructor(args: string[], reason: "not_in_allowlist" | "never_allowed") {
    const wayForward =
      reason === "never_allowed"
        ? "It is on the never-allowed list (catastrophic data-loss commands and raw eval) and does not run through wp-cli here, on any target. For `eval`, use rolepod_wp_execute_php; the rest are for a person at a shell."
        : "It is not on the read-only allow-list — pass allow_destructive=true to run a mutating subcommand.";
    super(
      "WPCLI_BLOCKED",
      `wp-cli subcommand blocked (${reason}): ${args.slice(0, 3).join(" ")}. ${wayForward}`,
      { args, reason },
    );
  }
}

export class FsScopeError extends WplabError {
  constructor(path: string, reason: string) {
    super("FS_SCOPE_VIOLATION", `Path outside allowed scope: ${reason}`, {
      path,
      reason,
    });
  }
}

export class ProductionBlockedError extends WplabError {
  constructor(siteurl: string, matchedPattern: string) {
    super(
      "PRODUCTION_BLOCKED",
      `Operation refused on ${siteurl} — production guard matched: ${matchedPattern}. No confirm flag lifts this one. Way forward: the site owner turns on AI Full Control (wp-admin → Rolepod WP → Settings), which outranks every detection signal; for a host listed in ROLEPOD_WPLAB_PROD_HOSTS with no companion, remove it there and restart the server.`,
      {
        siteurl,
        matchedPattern,
      },
    );
  }
}

export class DbWriteBlockedError extends WplabError {
  constructor(sql: string) {
    super(
      "DB_WRITE_BLOCKED",
      "DB query rejected: write not allowed without allow_write: true",
      {
        sql_preview: sql.slice(0, 200),
      },
    );
  }
}

/**
 * A tool that only works through the companion, called on a target without
 * one. Names the install and the reconnect so the model hands the user a
 * link instead of a dead end.
 */
export class CompanionRequiredError extends WplabError {
  constructor(tool: string, targetId: string, why?: string) {
    super(
      "COMPANION_REQUIRED",
      `${tool} requires the rolepod-wp companion${why ? ` (${why})` : ""}, and target ${targetId} has none. Install it — ${COMPANION_INSTALL_URL} via wp-admin → Plugins → Add New → Upload Plugin — pair it (Tools → Rolepod WP Setup → Generate pair token → rolepod_wp_pair), then reconnect with rolepod_wp_connect_rest.`,
      { targetId, tool, companion_install_url: COMPANION_INSTALL_URL },
    );
  }
}

export class CompanionUnavailableError extends WplabError {
  constructor(
    targetId: string,
    detail: string,
    opts: { installUrl?: string } = {},
  ) {
    const lines = [`Companion plugin not reachable: ${detail}`];
    if (opts.installUrl) {
      lines.push(`Install or upgrade: ${opts.installUrl}`);
    }
    super("COMPANION_UNAVAILABLE", lines.join("\n"), {
      targetId,
      ...(opts.installUrl ? { companion_install_url: opts.installUrl } : {}),
    });
  }
}

export class PowerProfileRequiredError extends WplabError {
  constructor() {
    super(
      "POWER_PROFILE_REQUIRED",
      [
        "wp_execute_php requires the power profile.",
        "Set environment variable ROLEPOD_WPLAB_PROFILE=power in your MCP client config.",
        "",
        "Claude Code .mcp.json example:",
        '  "mcpServers": {',
        '    "rolepod-wplab": {',
        '      "command": "npx",',
        '      "args": ["-y", "@rolepod/wplab@latest", "serve"],',
        '      "env": { "ROLEPOD_WPLAB_PROFILE": "power" }',
        "    }",
        "  }",
        "",
        "After editing .mcp.json, restart the MCP client. The power profile is intentionally",
        "opt-in — execute-php runs arbitrary PHP on a live WP install and should only be",
        "enabled when you actively need it. Other MCP tools (post_create, option_set,",
        "site_scaffold, etc.) work without the power profile.",
      ].join("\n"),
      { env_var: "ROLEPOD_WPLAB_PROFILE", required_value: "power" },
    );
  }
}

export class AstRejectedError extends WplabError {
  constructor(token: string, location: string) {
    super("AST_REJECTED", `Forbidden token in payload: ${token}`, {
      token,
      location,
    });
  }
}

/**
 * Thrown when the main companion namespace (wplab/v1) is unreachable but the
 * mu-plugin guardian namespace (wplab-recovery/v1) is alive. Surfaces last
 * fatal so the AI can call recovery tools (disable plugin/file, restore
 * snapshot) before retrying the original op.
 */
export class RecoveryModeError extends WplabError {
  constructor(detail: {
    targetId: string;
    lastFatal: Record<string, unknown> | null;
    recentFatals: Array<Record<string, unknown>>;
    guardianVersion: string;
  }) {
    const fatalLine = detail.lastFatal
      ? `last fatal: ${detail.lastFatal["message"] ?? "unknown"} at ${detail.lastFatal["file"] ?? "?"}:${detail.lastFatal["line"] ?? "?"}`
      : "no fatal recorded";
    super(
      "RECOVERY_MODE",
      `Main plugin down on target ${detail.targetId} — guardian is alive (${fatalLine}). Use rolepod_wp_recovery_* tools to fix.`,
      {
        targetId: detail.targetId,
        last_fatal: detail.lastFatal,
        recent_fatals: detail.recentFatals,
        guardian_version: detail.guardianVersion,
      },
    );
  }
}
