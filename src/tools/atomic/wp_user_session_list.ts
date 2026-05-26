import {
  UserSessionListInputSchema,
  UserSessionListOutputSchema,
  type UserSessionListInput,
  type UserSessionListOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpUserSessionListToolDef = {
  name: "rolepod_wp_user_session_list",
  description:
    "List active user sessions via wp_usermeta session_tokens. Useful for security audit (who is logged in, where from). Shell-capable targets only.",
  inputSchema: UserSessionListInputSchema,
};

export async function wpUserSessionListHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<UserSessionListOutput> {
  const input: UserSessionListInput = UserSessionListInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  if (
    target.kind !== "local" &&
    target.kind !== "ssh" &&
    target.kind !== "docker"
  ) {
    throw new WplabError(
      "USER_SESSION_REQUIRES_SHELL",
      "wp_user_session_list requires shell target (wp-cli user meta).",
      { kind: target.kind },
    );
  }

  const usersR = await target.wpCli([
    "user",
    "list",
    `--number=${input.per_page}`,
    "--fields=ID,user_login",
    "--format=json",
  ]);
  if (usersR.exitCode !== 0) {
    throw new WplabError("USER_LIST_FAILED", usersR.stderr.slice(0, 200), {
      exitCode: usersR.exitCode,
    });
  }
  let users: Array<{ ID: number; user_login: string }> = [];
  try {
    users = JSON.parse(usersR.stdout || "[]");
  } catch {
    users = [];
  }

  const sessions: UserSessionListOutput["sessions"] = [];
  for (const u of users) {
    const meta = await target.wpCli([
      "user",
      "meta",
      "get",
      String(u.ID),
      "session_tokens",
      "--format=json",
    ]);
    if (meta.exitCode !== 0 || meta.stdout.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(meta.stdout);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const tokens = Object.values(raw as Record<string, unknown>);
    const tokenInfos = tokens.map((tok) => {
      const t = (tok ?? {}) as {
        ip?: string;
        ua?: string;
        login?: number;
        expiration?: number;
      };
      const info: {
        login_ip?: string;
        ua?: string;
        login_time_gmt?: string;
        expiration_gmt?: string;
      } = {};
      if (typeof t.ip === "string") info.login_ip = t.ip;
      if (typeof t.ua === "string") info.ua = t.ua;
      if (typeof t.login === "number")
        info.login_time_gmt = new Date(t.login * 1000).toISOString();
      if (typeof t.expiration === "number")
        info.expiration_gmt = new Date(t.expiration * 1000).toISOString();
      return info;
    });
    sessions.push({
      user_id: u.ID,
      user_login: u.user_login,
      token_count: tokenInfos.length,
      tokens: tokenInfos,
    });
  }

  return UserSessionListOutputSchema.parse({
    total_users_with_sessions: sessions.length,
    sessions,
  });
}
