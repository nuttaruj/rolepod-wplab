import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  UserWriteInputSchema,
  UserWriteOutputSchema,
  type UserWriteInput,
  type UserWriteOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpUserWriteToolDef = {
  name: "rolepod_wp_user_write",
  description:
    "Create, update, or delete a WordPress user. Dual-path: wp-cli for shell targets, WP REST for RestTarget. DELETE ALWAYS requires reassign_to (the user id that inherits the deleted user's posts) — a delete without it is refused (USER_DELETE_NEEDS_REASSIGN) so authored content is never destroyed with the account. Production writes need confirm=true. Ledger records on rest targets only.",
  inputSchema: UserWriteInputSchema,
};

function isShell(t: Target): boolean {
  return t.kind === "local" || t.kind === "ssh" || t.kind === "docker";
}

export async function wpUserWriteHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<UserWriteOutput> {
  const input: UserWriteInput = UserWriteInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const shell = isShell(target);

  // Refuse a content-destroying delete before anything else.
  if (input.action === "delete" && input.reassign_to === undefined) {
    throw new WplabError(
      "USER_DELETE_NEEDS_REASSIGN",
      "user delete requires reassign_to — the user id that inherits the deleted user's posts. Refusing to destroy authored content.",
      { id: input.id },
    );
  }

  // Production gate (match + confirm, not hard enforce — user CRUD on prod must
  // be possible with an explicit confirm).
  const matched = prodGuard.matches(target.siteurl);
  if (matched.matched && !input.confirm) {
    throw new WplabError(
      "PRODUCTION_BLOCKED",
      `user ${input.action} blocked on production-matched target — pass confirm=true`,
      { siteurl: target.siteurl, matchedPattern: matched.pattern },
    );
  }

  if ((input.action === "update" || input.action === "delete") && !input.id) {
    throw new WplabError(
      "USER_ID_REQUIRED",
      `action=${input.action} requires id`,
      {},
    );
  }
  if (input.action === "create" && (!input.username || !input.email)) {
    throw new WplabError(
      "USER_CREATE_FIELDS_REQUIRED",
      "action=create requires username and email",
      {},
    );
  }

  const userId = shell
    ? await writeCli(target, input)
    : await writeRest(target, input);

  await recordChange(target, {
    category: "user",
    subcategory: input.action,
    targetDescriptor: `${input.action} user #${userId}`,
    beforeState:
      input.action === "create" ? { existed: false } : { user_id: userId },
    afterState:
      input.action === "delete"
        ? { deleted: true, reassigned_to: input.reassign_to }
        : { user_id: userId, role: input.role ?? null },
    // Deletes are destructive-irreversible; create/update are logically undoable.
    reversible: input.action !== "delete",
    sourceTool: "wp_user_write",
    ...(input.action === "delete"
      ? { notes: `posts reassigned to user #${input.reassign_to}` }
      : {}),
  });

  return UserWriteOutputSchema.parse({
    action: input.action,
    source: shell ? "wp_cli" : "rest",
    user_id: userId,
    ...(input.action === "delete" ? { reassigned_to: input.reassign_to } : {}),
  });
}

// ── wp-cli branch ──────────────────────────────────────────────────────────

async function writeCli(
  target: Target,
  input: UserWriteInput,
): Promise<number> {
  if (input.action === "create") {
    const args = [
      "user",
      "create",
      input.username!,
      input.email!,
      "--porcelain",
    ];
    if (input.role) args.push(`--role=${input.role}`);
    if (input.password) args.push(`--user_pass=${input.password}`);
    if (input.display_name) args.push(`--display_name=${input.display_name}`);
    const r = await target.wpCli(args, { allowDestructive: true });
    if (r.exitCode !== 0) {
      throw new WplabError(
        "USER_CREATE_FAILED",
        `wp user create exit ${r.exitCode}`,
        {
          stderr: r.stderr.slice(0, 200),
        },
      );
    }
    const id = Number(r.stdout.trim());
    if (!Number.isFinite(id)) {
      throw new WplabError(
        "USER_CREATE_NO_ID",
        "wp user create returned no id",
        {
          stdout: r.stdout.slice(0, 200),
        },
      );
    }
    return id;
  }

  if (input.action === "update") {
    const args = ["user", "update", String(input.id)];
    if (input.role) args.push(`--role=${input.role}`);
    if (input.password) args.push(`--user_pass=${input.password}`);
    if (input.display_name) args.push(`--display_name=${input.display_name}`);
    if (input.email) args.push(`--user_email=${input.email}`);
    const r = await target.wpCli(args, { allowDestructive: true });
    if (r.exitCode !== 0) {
      throw new WplabError(
        "USER_UPDATE_FAILED",
        `wp user update exit ${r.exitCode}`,
        {
          stderr: r.stderr.slice(0, 200),
        },
      );
    }
    return input.id!;
  }

  // delete — reassign_to already enforced.
  const r = await target.wpCli(
    [
      "user",
      "delete",
      String(input.id),
      `--reassign=${input.reassign_to}`,
      "--yes",
    ],
    { allowDestructive: true },
  );
  if (r.exitCode !== 0) {
    throw new WplabError(
      "USER_DELETE_FAILED",
      `wp user delete exit ${r.exitCode}`,
      {
        stderr: r.stderr.slice(0, 200),
      },
    );
  }
  return input.id!;
}

// ── REST branch ────────────────────────────────────────────────────────────

async function writeRest(
  target: Target,
  input: UserWriteInput,
): Promise<number> {
  if (input.action === "create") {
    const body: Record<string, unknown> = {
      username: input.username,
      email: input.email,
    };
    if (input.password) body["password"] = input.password;
    if (input.role) body["roles"] = [input.role];
    if (input.display_name) body["name"] = input.display_name;
    const res = await target.rest({
      method: "POST",
      path: "/wp/v2/users",
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "USER_CREATE_FAILED",
        `REST POST /wp/v2/users returned HTTP ${res.status}`,
        { status: res.status, body: res.body },
      );
    }
    const id = Number((res.body as Record<string, unknown>)?.["id"]);
    if (!Number.isFinite(id)) {
      throw new WplabError(
        "USER_CREATE_NO_ID",
        "REST user create returned no id",
        {
          body: res.body,
        },
      );
    }
    return id;
  }

  if (input.action === "update") {
    const body: Record<string, unknown> = {};
    if (input.role) body["roles"] = [input.role];
    if (input.display_name) body["name"] = input.display_name;
    if (input.password) body["password"] = input.password;
    if (input.email) body["email"] = input.email;
    const res = await target.rest({
      method: "POST",
      path: `/wp/v2/users/${input.id}`,
      body,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new WplabError(
        "USER_UPDATE_FAILED",
        `REST POST /wp/v2/users/${input.id} returned HTTP ${res.status}`,
        { status: res.status, body: res.body },
      );
    }
    return input.id!;
  }

  // delete — WP users can't be trashed: force=true + reassign are both required.
  const res = await target.rest({
    method: "DELETE",
    path: `/wp/v2/users/${input.id}`,
    query: { force: true, reassign: input.reassign_to! },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "USER_DELETE_FAILED",
      `REST DELETE /wp/v2/users/${input.id} returned HTTP ${res.status}`,
      { status: res.status, body: res.body },
    );
  }
  return input.id!;
}
