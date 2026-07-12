import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  CommentInputSchema,
  CommentOutputSchema,
  type CommentInput,
  type CommentOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpCommentToolDef = {
  name: "rolepod_wp_comment",
  description:
    "List, moderate, or delete comments. Dual-path: wp-cli for shell targets, WP REST for RestTarget. moderate sets status (approve / hold / spam / trash); delete with force=true removes permanently (else trashes). Production writes need confirm=true. Ledger records on rest targets only.",
  inputSchema: CommentInputSchema,
};

function isShell(t: Target): boolean {
  return t.kind === "local" || t.kind === "ssh" || t.kind === "docker";
}

// moderate status → REST comment status value.
const REST_STATUS: Record<string, string> = {
  approve: "approved",
  hold: "hold",
  spam: "spam",
  trash: "trash",
};
// moderate status → wp-cli subcommand.
const CLI_SUBCOMMAND: Record<string, string> = {
  approve: "approve",
  hold: "unapprove",
  spam: "spam",
  trash: "trash",
};

export async function wpCommentHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<CommentOutput> {
  const input: CommentInput = CommentInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const shell = isShell(target);

  if (input.action !== "list") {
    const matched = prodGuard.matches(target.siteurl);
    if (matched.matched && !input.confirm) {
      throw new WplabError(
        "PRODUCTION_BLOCKED",
        `comment ${input.action} blocked on production-matched target — pass confirm=true`,
        { siteurl: target.siteurl, matchedPattern: matched.pattern },
      );
    }
    if (!input.id) {
      throw new WplabError(
        "COMMENT_ID_REQUIRED",
        `action=${input.action} requires id`,
        {},
      );
    }
    if (input.action === "moderate" && !input.status) {
      throw new WplabError(
        "COMMENT_STATUS_REQUIRED",
        "action=moderate requires status (approve/hold/spam/trash)",
        {},
      );
    }
  }

  if (input.action === "list") {
    const comments = shell
      ? await listCli(target, input)
      : await listRest(target, input);
    return CommentOutputSchema.parse({
      action: "list",
      source: shell ? "wp_cli" : "rest",
      comments,
    });
  }

  if (input.action === "moderate") {
    if (shell) await moderateCli(target, input);
    else await moderateRest(target, input);
    await recordChange(target, {
      category: "comment",
      subcategory: "moderate",
      targetDescriptor: `moderate comment #${input.id} → ${input.status}`,
      beforeState: { comment_id: input.id },
      afterState: { comment_id: input.id, status: input.status },
      reversible: true,
      sourceTool: "wp_comment",
    });
    return CommentOutputSchema.parse({
      action: "moderate",
      source: shell ? "wp_cli" : "rest",
      comment_id: input.id,
      status: input.status,
    });
  }

  // delete
  if (shell) await deleteCli(target, input);
  else await deleteRest(target, input);
  await recordChange(target, {
    category: "comment",
    subcategory: "delete",
    targetDescriptor: `delete comment #${input.id}${input.force ? " (force)" : " (trash)"}`,
    beforeState: { comment_id: input.id },
    afterState: { deleted: true, force: input.force },
    // Trash is reversible; a forced permanent delete is not.
    reversible: !input.force,
    sourceTool: "wp_comment",
  });
  return CommentOutputSchema.parse({
    action: "delete",
    source: shell ? "wp_cli" : "rest",
    comment_id: input.id,
  });
}

// ── wp-cli branch ──────────────────────────────────────────────────────────

async function listCli(
  target: Target,
  input: CommentInput,
): Promise<Array<Record<string, unknown>>> {
  const args = [
    "comment",
    "list",
    "--format=json",
    `--number=${input.per_page}`,
  ];
  if (input.post !== undefined) args.push(`--post_id=${input.post}`);
  const r = await target.wpCli(args);
  if (r.exitCode !== 0) {
    throw new WplabError(
      "COMMENT_LIST_FAILED",
      `wp comment list exit ${r.exitCode}`,
      {
        stderr: r.stderr.slice(0, 200),
      },
    );
  }
  try {
    return JSON.parse(r.stdout || "[]");
  } catch {
    return [];
  }
}

async function moderateCli(target: Target, input: CommentInput): Promise<void> {
  const sub = CLI_SUBCOMMAND[input.status!]!;
  const r = await target.wpCli(["comment", sub, String(input.id)], {
    allowDestructive: true,
  });
  if (r.exitCode !== 0) {
    throw new WplabError(
      "COMMENT_MODERATE_FAILED",
      `wp comment ${sub} exit ${r.exitCode}`,
      { stderr: r.stderr.slice(0, 200) },
    );
  }
}

async function deleteCli(target: Target, input: CommentInput): Promise<void> {
  const args = ["comment", "delete", String(input.id)];
  if (input.force) args.push("--force");
  const r = await target.wpCli(args, { allowDestructive: true });
  if (r.exitCode !== 0) {
    throw new WplabError(
      "COMMENT_DELETE_FAILED",
      `wp comment delete exit ${r.exitCode}`,
      {
        stderr: r.stderr.slice(0, 200),
      },
    );
  }
}

// ── REST branch ────────────────────────────────────────────────────────────

async function listRest(
  target: Target,
  input: CommentInput,
): Promise<Array<Record<string, unknown>>> {
  const query: Record<string, string | number> = {
    per_page: input.per_page,
    context: "edit",
  };
  if (input.post !== undefined) query["post"] = input.post;
  const res = await target.rest({
    method: "GET",
    path: "/wp/v2/comments",
    query,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "COMMENT_LIST_FAILED",
      `REST GET /wp/v2/comments returned HTTP ${res.status}`,
      { status: res.status },
    );
  }
  return Array.isArray(res.body)
    ? (res.body as Array<Record<string, unknown>>)
    : [];
}

async function moderateRest(
  target: Target,
  input: CommentInput,
): Promise<void> {
  const res = await target.rest({
    method: "POST",
    path: `/wp/v2/comments/${input.id}`,
    body: { status: REST_STATUS[input.status!] },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "COMMENT_MODERATE_FAILED",
      `REST POST /wp/v2/comments/${input.id} returned HTTP ${res.status}`,
      { status: res.status, body: res.body },
    );
  }
}

async function deleteRest(target: Target, input: CommentInput): Promise<void> {
  const res = await target.rest({
    method: "DELETE",
    path: `/wp/v2/comments/${input.id}`,
    query: { force: input.force },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "COMMENT_DELETE_FAILED",
      `REST DELETE /wp/v2/comments/${input.id} returned HTTP ${res.status}`,
      { status: res.status, body: res.body },
    );
  }
}
