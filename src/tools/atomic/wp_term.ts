import { ProdGuard } from "../../safety/ProdGuard.js";
import { recordChange } from "../../companion/ledger.js";
import {
  TermInputSchema,
  TermOutputSchema,
  type TermInput,
  type TermOutput,
} from "../../schema/tools.js";
import { WplabError } from "../../util/errors.js";
import type { Target } from "../../runtime/Target.js";
import type { TargetRegistry } from "../../target/TargetRegistry.js";

export const wpTermToolDef = {
  name: "rolepod_wp_term",
  description:
    "List, create, or ensure a taxonomy term (category / tag / custom taxonomy). Dual-path: wp-cli for shell targets (local/ssh/docker), WP REST for RestTarget. action=ensure is idempotent — returns the existing term if one with the same slug/name is present (existed:true), otherwise creates it. Production writes need confirm=true. Ledger records on rest targets only.",
  inputSchema: TermInputSchema,
};

function isShell(t: Target): boolean {
  return t.kind === "local" || t.kind === "ssh" || t.kind === "docker";
}

/** REST base for a taxonomy: built-ins map, custom uses the override or the key. */
function restBaseFor(taxonomy: string, override?: string): string {
  if (override) return override;
  if (taxonomy === "category") return "categories";
  if (taxonomy === "post_tag") return "tags";
  return taxonomy;
}

export async function wpTermHandler(
  registry: TargetRegistry,
  prodGuard: ProdGuard,
  raw: unknown,
): Promise<TermOutput> {
  const input: TermInput = TermInputSchema.parse(raw);
  const target = registry.get(input.target_id);
  const shell = isShell(target);

  // Production gate on writes only.
  if (input.action !== "list") {
    const matched = prodGuard.matches(target.siteurl);
    if (matched.matched && !input.confirm) {
      throw new WplabError(
        "PRODUCTION_BLOCKED",
        `term ${input.action} blocked on production-matched target — pass confirm=true`,
        { siteurl: target.siteurl, matchedPattern: matched.pattern },
      );
    }
  }

  if (input.action === "list") {
    const terms = shell
      ? await listCli(target, input)
      : await listRest(target, input);
    return TermOutputSchema.parse({
      action: "list",
      taxonomy: input.taxonomy,
      source: shell ? "wp_cli" : "rest",
      terms,
    });
  }

  if (input.action === "ensure") {
    const existing = shell
      ? await findCli(target, input)
      : await findRest(target, input);
    if (existing !== null) {
      return TermOutputSchema.parse({
        action: "ensure",
        taxonomy: input.taxonomy,
        source: shell ? "wp_cli" : "rest",
        term_id: existing,
        existed: true,
      });
    }
  }

  // create (or ensure-miss falls through to create)
  if (input.name === undefined || input.name === "") {
    throw new WplabError(
      "TERM_NAME_REQUIRED",
      `action=${input.action} requires a term name`,
      {},
    );
  }
  const termId = shell
    ? await createCli(target, input)
    : await createRest(target, input);

  await recordChange(target, {
    category: "term",
    subcategory: input.taxonomy,
    targetDescriptor: `create term #${termId} "${input.name}" in ${input.taxonomy}`,
    beforeState: { existed: false },
    afterState: { term_id: termId, name: input.name, slug: input.slug ?? null },
    reversible: true,
    sourceTool: "wp_term",
  });

  return TermOutputSchema.parse({
    action: input.action === "ensure" ? "ensure" : "create",
    taxonomy: input.taxonomy,
    source: shell ? "wp_cli" : "rest",
    term_id: termId,
    ...(input.action === "ensure" ? { existed: false } : {}),
  });
}

// ── wp-cli branch ──────────────────────────────────────────────────────────

async function listCli(
  target: Target,
  input: TermInput,
): Promise<Array<Record<string, unknown>>> {
  const r = await target.wpCli([
    "term",
    "list",
    input.taxonomy,
    "--format=json",
    `--number=${input.per_page}`,
  ]);
  if (r.exitCode !== 0) {
    throw new WplabError(
      "TERM_LIST_FAILED",
      `wp term list exit ${r.exitCode}`,
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

async function findCli(
  target: Target,
  input: TermInput,
): Promise<number | null> {
  const terms = await listCli(target, input);
  const want = (input.slug ?? input.name ?? "").toLowerCase();
  for (const t of terms) {
    const slug = String(t["slug"] ?? "").toLowerCase();
    const name = String(t["name"] ?? "").toLowerCase();
    if (want && (slug === want || name === want)) {
      const id = Number(t["term_id"] ?? t["id"]);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

async function createCli(target: Target, input: TermInput): Promise<number> {
  const args = ["term", "create", input.taxonomy, input.name!, "--porcelain"];
  if (input.slug) args.push(`--slug=${input.slug}`);
  if (input.parent !== undefined) args.push(`--parent=${input.parent}`);
  if (input.description) args.push(`--description=${input.description}`);
  const r = await target.wpCli(args, { allowDestructive: true });
  if (r.exitCode !== 0) {
    throw new WplabError(
      "TERM_CREATE_FAILED",
      `wp term create exit ${r.exitCode}`,
      { stderr: r.stderr.slice(0, 200) },
    );
  }
  const id = Number(r.stdout.trim());
  if (!Number.isFinite(id)) {
    throw new WplabError("TERM_CREATE_NO_ID", "wp term create returned no id", {
      stdout: r.stdout.slice(0, 200),
    });
  }
  return id;
}

// ── REST branch ────────────────────────────────────────────────────────────

async function listRest(
  target: Target,
  input: TermInput,
): Promise<Array<Record<string, unknown>>> {
  const base = restBaseFor(input.taxonomy, input.rest_base);
  const res = await target.rest({
    method: "GET",
    path: `/wp/v2/${base}`,
    query: { per_page: input.per_page },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "TERM_LIST_FAILED",
      `REST GET /wp/v2/${base} returned HTTP ${res.status}`,
      { status: res.status },
    );
  }
  return Array.isArray(res.body)
    ? (res.body as Array<Record<string, unknown>>)
    : [];
}

async function findRest(
  target: Target,
  input: TermInput,
): Promise<number | null> {
  const base = restBaseFor(input.taxonomy, input.rest_base);
  const query: Record<string, string | number> = { per_page: 100 };
  if (input.slug) query["slug"] = input.slug;
  else if (input.name) query["search"] = input.name;
  const res = await target.rest({
    method: "GET",
    path: `/wp/v2/${base}`,
    query,
  });
  if (res.status < 200 || res.status >= 300) return null;
  const rows = Array.isArray(res.body)
    ? (res.body as Array<Record<string, unknown>>)
    : [];
  const wantSlug = (input.slug ?? "").toLowerCase();
  const wantName = (input.name ?? "").toLowerCase();
  for (const t of rows) {
    const slug = String(t["slug"] ?? "").toLowerCase();
    const name = String(t["name"] ?? "").toLowerCase();
    if (
      (wantSlug && slug === wantSlug) ||
      (!wantSlug && wantName && name === wantName)
    ) {
      const id = Number(t["id"]);
      if (Number.isFinite(id)) return id;
    }
  }
  return null;
}

async function createRest(target: Target, input: TermInput): Promise<number> {
  const base = restBaseFor(input.taxonomy, input.rest_base);
  const body: Record<string, unknown> = { name: input.name };
  if (input.slug) body["slug"] = input.slug;
  if (input.parent !== undefined) body["parent"] = input.parent;
  if (input.description) body["description"] = input.description;
  const res = await target.rest({
    method: "POST",
    path: `/wp/v2/${base}`,
    body,
  });
  if (res.status < 200 || res.status >= 300) {
    throw new WplabError(
      "TERM_CREATE_FAILED",
      `REST POST /wp/v2/${base} returned HTTP ${res.status}`,
      { status: res.status, body: res.body },
    );
  }
  const id = Number((res.body as Record<string, unknown>)?.["id"]);
  if (!Number.isFinite(id)) {
    throw new WplabError(
      "TERM_CREATE_NO_ID",
      "REST term create returned no id",
      {
        body: res.body,
      },
    );
  }
  return id;
}
