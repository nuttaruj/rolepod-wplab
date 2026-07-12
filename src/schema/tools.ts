import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * target_id accepts either:
 *   - `tgt_<8+ lowercase hex>` — live session id from connect_rest/connect_local/pair
 *   - `@<alias>` — persistent alias configured via rolepod_wp_target_alias
 *     (resolved + auto-reconnected by the dispatcher before the handler runs)
 */
export const TargetIdSchema = z
  .string()
  .regex(/^(?:tgt_[a-z0-9]{8,}|@[a-z][a-z0-9_-]{0,30})$/, {
    message:
      "target_id must be either `tgt_<8+ lowercase hex>` (live session) or `@<alias>` (persistent alias)",
  });

export const RunIdSchema = z.string().regex(/^wplab_\d{8}T\d{6}_[a-z0-9]{8}$/);

/**
 * Production-guard state, resolved once at connect time. `armed: true` means
 * write tools on this target require `confirm=true`.
 */
export const ProdGuardStatusSchema = z
  .object({
    armed: z.boolean(),
    env_type: z
      .string()
      .nullable()
      .describe(
        "Raw WP_ENVIRONMENT_TYPE. Empty string = unset (guard stays disarmed; WordPress' own default of 'production' is deliberately not trusted). null = the probe could not run.",
      ),
    reason: z.enum([
      "env_type",
      "host_pattern",
      "companion",
      "not_production",
      "unset",
      "probe_failed",
    ]),
  })
  .nullable()
  .describe(
    "Whether the production guard is armed for this target, and why. Disarmed on an unset or unprobeable environment type — an unguarded target is reported, never silently assumed safe.",
  );

// `confirm` / `allow_destructive` accept boolean true OR the literal string
// "true". Some MCP clients JSON-stringify booleans through transports without
// strict type preservation; we coerce both forms and enforce the semantic
// "must be true" — refuses false / "false" / missing.
const ConfirmTrueSchema = z
  .union([z.literal(true), z.literal("true")])
  .transform(() => true as const);

// JSON-object input that tolerates pre-stringified JSON from MCP clients
// that serialize nested objects as strings (Round 6 caught this on
// woo_write `fields` — "Expected object, received string"). Accepts either
// a real object or a string that parses to a non-null object/array.
const JsonObjectSchema = z.preprocess(
  (v) => {
    if (typeof v !== "string") return v;
    try {
      const parsed: unknown = JSON.parse(v);
      return parsed;
    } catch {
      return v;
    }
  },
  z.record(z.string(), z.unknown()),
);

// ---------------------------------------------------------------------------
// rolepod_wp_connect_local
// ---------------------------------------------------------------------------

export const ConnectLocalInputSchema = z.object({
  path: z.string().min(1, "WP install path required"),
});
export type ConnectLocalInput = z.infer<typeof ConnectLocalInputSchema>;

export const ConnectLocalOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string().url(),
  wp_version: z.string(),
  php_version: z.string().optional(),
  companion: z
    .object({
      installed: z.boolean(),
      version: z.string().nullable(),
      capabilities: z.array(z.string()),
    })
    .nullable(),
  prod_guard: ProdGuardStatusSchema.optional(),
});
export type ConnectLocalOutput = z.infer<typeof ConnectLocalOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_connect_rest (W-027)
// ---------------------------------------------------------------------------

export const ConnectRestInputSchema = z.object({
  url: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), {
      message:
        "URL must use https:// (refuses plaintext App Password transport)",
    }),
  credential_ref: z
    .string()
    .optional()
    .describe(
      "Override default keychain lookup. If omitted, runtime resolves credentials by canonical hostname of url.",
    ),
  require_companion: z
    .boolean()
    .default(false)
    .describe(
      "Abort connect if companion handshake fails. Default: allow target open without companion (RestTarget still works for built-in REST routes).",
    ),
});
export type ConnectRestInput = z.infer<typeof ConnectRestInputSchema>;

export const ConnectRestOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string().url(),
  wp_version: z.string(),
  php_version: z.string().optional(),
  companion: z
    .object({
      installed: z.boolean(),
      enabled: z.boolean(),
      version: z.string().nullable(),
      capabilities: z.array(z.string()),
    })
    .nullable(),
  profile: z
    .object({
      active: z.enum(["strict", "personal", "power"]),
      execute_php_unlocked: z.boolean(),
      env_var_name: z.string(),
    })
    .optional()
    .describe(
      "Active MCP-server profile. strict = read-only + REST-bounded ops. personal = +wp-cli destructive ops. power = +execute_php arbitrary PHP. Set via env var ROLEPOD_WPLAB_PROFILE=power in MCP client config.",
    ),
  memory_summary: z
    .string()
    .optional()
    .describe(
      "Populated when per-site memory directory exists (W-028, v0.2+). Brief recap of stored notes.",
    ),
  warnings: z
    .array(
      z.object({
        code: z.string(),
        message: z.string(),
        suggested_fix: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Non-fatal issues detected at connect time (e.g. siteurl/home stored as http on an https-only site). Each entry has a machine-readable code and a human-readable suggested fix.",
    ),
  prod_guard: ProdGuardStatusSchema.optional(),
});
export type ConnectRestOutput = z.infer<typeof ConnectRestOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_connect_ssh (v0.3)
// ---------------------------------------------------------------------------

export const ConnectSshInputSchema = z.object({
  host: z.string().min(1),
  user: z.string().min(1),
  wp_path: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(22),
  private_key_path: z.string().optional(),
  password: z.string().optional(),
});
export type ConnectSshInput = z.infer<typeof ConnectSshInputSchema>;

export const ConnectSshOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string(),
  wp_version: z.string(),
  prod_guard: ProdGuardStatusSchema.optional(),
});
export type ConnectSshOutput = z.infer<typeof ConnectSshOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_connect_docker (v0.3)
// ---------------------------------------------------------------------------

export const ConnectDockerInputSchema = z.object({
  container_name: z.string().min(1),
  wp_path: z.string().default("/var/www/html"),
  docker_host: z.string().optional(),
  docker_socket_path: z.string().optional(),
});
export type ConnectDockerInput = z.infer<typeof ConnectDockerInputSchema>;

export const ConnectDockerOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string(),
  wp_version: z.string(),
  prod_guard: ProdGuardStatusSchema.optional(),
});
export type ConnectDockerOutput = z.infer<typeof ConnectDockerOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_disconnect
// ---------------------------------------------------------------------------

export const DisconnectInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type DisconnectInput = z.infer<typeof DisconnectInputSchema>;

export const DisconnectOutputSchema = z.object({
  closed: z.literal(true),
});
export type DisconnectOutput = z.infer<typeof DisconnectOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_cli_run
// ---------------------------------------------------------------------------

export const WpCliRunInputSchema = z.object({
  target_id: TargetIdSchema,
  args: z
    .array(z.string())
    .min(1, 'wp-cli args required (e.g. ["plugin","list"])'),
  allow_destructive: z.boolean().default(false),
  timeout_ms: z.number().int().positive().max(120_000).default(30_000),
});
export type WpCliRunInput = z.infer<typeof WpCliRunInputSchema>;

export const WpCliRunOutputSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
});
export type WpCliRunOutput = z.infer<typeof WpCliRunOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_health_check
// ---------------------------------------------------------------------------

export const WpHealthCheckInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type WpHealthCheckInput = z.infer<typeof WpHealthCheckInputSchema>;

export const WpHealthCheckOutputSchema = z.object({
  wp_version: z.string(),
  php_version: z.string().optional(),
  db_ok: z.boolean(),
  wp_cli_ok: z.boolean(),
  rest_ok: z.boolean(),
  companion_ok: z.boolean(),
  site_url: z.string().url(),
  prod_guard: ProdGuardStatusSchema.optional(),
  warnings: z.array(z.string()),
});
export type WpHealthCheckOutput = z.infer<typeof WpHealthCheckOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_post_get / list / create / update
// ---------------------------------------------------------------------------

export const PostGetInputSchema = z.object({
  target_id: TargetIdSchema,
  id: z.number().int().positive(),
  context: z.enum(["view", "edit", "embed"]).default("view"),
  type: z
    .string()
    .default("posts")
    .describe("REST collection slug (posts, pages, etc.)"),
});
export type PostGetInput = z.infer<typeof PostGetInputSchema>;

export const PostGetOutputSchema = z.object({
  status: z.number().int(),
  post: z.unknown(),
});
export type PostGetOutput = z.infer<typeof PostGetOutputSchema>;

export const PostListInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default("posts"),
  per_page: z.number().int().min(1).max(100).default(20),
  page: z.number().int().positive().default(1),
  search: z.string().optional(),
  status: z.string().optional(),
  orderby: z.string().optional(),
  order: z.enum(["asc", "desc"]).optional(),
});
export type PostListInput = z.infer<typeof PostListInputSchema>;

export const PostListOutputSchema = z.object({
  status: z.number().int(),
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative().optional(),
  total_pages: z.number().int().nonnegative().optional(),
});
export type PostListOutput = z.infer<typeof PostListOutputSchema>;

export const PostCreateInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default("posts"),
  title: z.string(),
  content: z.string(),
  status: z
    .enum(["publish", "future", "draft", "pending", "private"])
    .default("draft"),
  excerpt: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  categories: z
    .array(z.number().int().positive())
    .optional()
    .describe("Category term IDs to assign (core `category` taxonomy)."),
  tags: z
    .array(z.number().int().positive())
    .optional()
    .describe("Tag term IDs to assign (core `post_tag` taxonomy)."),
});
export type PostCreateInput = z.infer<typeof PostCreateInputSchema>;

export const PostCreateOutputSchema = z.object({
  status: z.number().int(),
  id: z.number().int().positive(),
  link: z.string().url().optional(),
});
export type PostCreateOutput = z.infer<typeof PostCreateOutputSchema>;

export const PostUpdateInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default("posts"),
  id: z.number().int().positive(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: z
    .enum(["publish", "future", "draft", "pending", "private"])
    .optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  categories: z
    .array(z.number().int().positive())
    .optional()
    .describe("Category term IDs to assign (replaces the current set)."),
  tags: z
    .array(z.number().int().positive())
    .optional()
    .describe("Tag term IDs to assign (replaces the current set)."),
});
export type PostUpdateInput = z.infer<typeof PostUpdateInputSchema>;

export const PostUpdateOutputSchema = z.object({
  status: z.number().int(),
  id: z.number().int().positive(),
  modified: z.string().optional(),
});
export type PostUpdateOutput = z.infer<typeof PostUpdateOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_option_get / set
// ---------------------------------------------------------------------------

export const OptionGetInputSchema = z.object({
  target_id: TargetIdSchema,
  name: z.string().min(1),
});
export type OptionGetInput = z.infer<typeof OptionGetInputSchema>;

export const OptionGetOutputSchema = z.object({
  name: z.string(),
  value: z.unknown(),
  source: z
    .enum(["wp_cli", "rest_settings", "companion_option_get"])
    .describe("which transport actually returned the value"),
});
export type OptionGetOutput = z.infer<typeof OptionGetOutputSchema>;

export const OptionSetInputSchema = z.object({
  target_id: TargetIdSchema,
  name: z.string().min(1),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.record(z.string(), z.unknown()),
    z.array(z.unknown()),
  ]),
  confirm: z
    .boolean()
    .default(false)
    .describe("Required true on production-matched targets"),
});
export type OptionSetInput = z.infer<typeof OptionSetInputSchema>;

export const OptionSetOutputSchema = z.object({
  name: z.string(),
  changed: z.boolean(),
  source: z.enum(["wp_cli", "rest_settings", "companion_option_set"]),
});
export type OptionSetOutput = z.infer<typeof OptionSetOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_user_list
// ---------------------------------------------------------------------------

export const UserListInputSchema = z.object({
  target_id: TargetIdSchema,
  per_page: z.number().int().min(1).max(100).default(20),
  page: z.number().int().positive().default(1),
  search: z.string().optional(),
  role: z.string().optional(),
});
export type UserListInput = z.infer<typeof UserListInputSchema>;

export const UserListOutputSchema = z.object({
  status: z.number().int(),
  users: z.array(z.unknown()),
});
export type UserListOutput = z.infer<typeof UserListOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_db_query
// ---------------------------------------------------------------------------

export const DbQueryInputSchema = z.object({
  target_id: TargetIdSchema,
  sql: z.string().min(1),
  allow_write: z
    .boolean()
    .default(false)
    .describe(
      "Override SELECT-only guard. Production guard still applies on top.",
    ),
  confirm: z
    .boolean()
    .default(false)
    .describe(
      "Required true on production-matched targets when allow_write=true",
    ),
});
export type DbQueryInput = z.infer<typeof DbQueryInputSchema>;

export const DbQueryOutputSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().int(),
});
export type DbQueryOutput = z.infer<typeof DbQueryOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_rest_request — generic REST passthrough
// ---------------------------------------------------------------------------

export const RestRequestInputSchema = z.object({
  target_id: TargetIdSchema,
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  path: z
    .string()
    .min(1)
    .describe('REST route, e.g. "/wp/v2/posts" — leading slash optional'),
  query: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type RestRequestInput = z.infer<typeof RestRequestInputSchema>;

export const RestRequestOutputSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
  headers: z.record(z.string(), z.string()),
});
export type RestRequestOutput = z.infer<typeof RestRequestOutputSchema>;

// ---------------------------------------------------------------------------
// Composites — v0.2 (phase-aware orchestrations)
// ---------------------------------------------------------------------------

const RunIdShape = z.string().regex(/^wplab_\d{8}T\d{6}_[a-z0-9]{8}$/);

export const ScaffoldBlockInputSchema = z.object({
  target_id: TargetIdSchema,
  plugin_slug: z.string().min(1),
  block_slug: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/, {
    message: 'block_slug must be namespaced like "my-team/testimonial-card"',
  }),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default("design"),
  icon: z.string().default("star-filled"),
  render_strategy: z.enum(["dynamic", "static"]).default("dynamic"),
  allow_destructive: ConfirmTrueSchema,
});
export type ScaffoldBlockInput = z.infer<typeof ScaffoldBlockInputSchema>;

export const ScaffoldBlockOutputSchema = z.object({
  run_id: RunIdShape,
  files_written: z.array(z.string()),
  next_steps: z.array(z.string()),
});
export type ScaffoldBlockOutput = z.infer<typeof ScaffoldBlockOutputSchema>;

export const ScaffoldPluginInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().default("AI-generated"),
  features: z
    .array(
      z.enum(["rest_endpoint", "admin_page", "gutenberg_block", "cli_command"]),
    )
    .default([]),
  allow_destructive: ConfirmTrueSchema,
});
export type ScaffoldPluginInput = z.infer<typeof ScaffoldPluginInputSchema>;

export const ScaffoldPluginOutputSchema = z.object({
  run_id: RunIdShape,
  plugin_path: z.string(),
  files_written: z.array(z.string()),
  activate_command: z.string(),
});
export type ScaffoldPluginOutput = z.infer<typeof ScaffoldPluginOutputSchema>;

export const ScaffoldThemeInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().default("AI-generated"),
  allow_destructive: ConfirmTrueSchema,
});
export type ScaffoldThemeInput = z.infer<typeof ScaffoldThemeInputSchema>;

export const ScaffoldThemeOutputSchema = z.object({
  run_id: RunIdShape,
  theme_path: z.string(),
  files_written: z.array(z.string()),
  activate_command: z.string(),
});
export type ScaffoldThemeOutput = z.infer<typeof ScaffoldThemeOutputSchema>;

export const AuditSecurityInputSchema = z.object({
  target_id: TargetIdSchema,
  report_format: z.enum(["markdown", "json"]).default("markdown"),
});
export type AuditSecurityInput = z.infer<typeof AuditSecurityInputSchema>;

export const AuditSecurityOutputSchema = z.object({
  run_id: RunIdShape,
  wp_core_outdated: z.boolean(),
  outdated_plugins: z.array(
    z.object({ slug: z.string(), current: z.string(), latest: z.string() }),
  ),
  outdated_themes: z.array(
    z.object({ slug: z.string(), current: z.string(), latest: z.string() }),
  ),
  weak_admin_users: z.array(
    z.object({ login: z.string(), reason: z.string() }),
  ),
  wp_debug_on: z.boolean(),
  report_path: z.string(),
});
export type AuditSecurityOutput = z.infer<typeof AuditSecurityOutputSchema>;

export const MigrateDryrunInputSchema = z.object({
  source_target_id: TargetIdSchema,
  dest_target_id: TargetIdSchema,
  scope: z
    .array(z.enum(["posts", "options", "users", "plugin_versions"]))
    .default(["plugin_versions"]),
});
export type MigrateDryrunInput = z.infer<typeof MigrateDryrunInputSchema>;

export const MigrateDryrunOutputSchema = z.object({
  run_id: RunIdShape,
  plan: z.record(z.string(), z.unknown()),
  plan_path: z.string(),
});
export type MigrateDryrunOutput = z.infer<typeof MigrateDryrunOutputSchema>;

// --- Cross-target composites (v0.3) ---

export const AuditManyInputSchema = z.object({
  target_ids: z.array(TargetIdSchema).min(1),
  report_format: z.enum(["markdown", "json"]).default("markdown"),
});
export type AuditManyInput = z.infer<typeof AuditManyInputSchema>;

export const AuditManyOutputSchema = z.object({
  run_id: RunIdShape,
  reports: z.array(
    z.object({
      target_id: TargetIdSchema,
      siteurl: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
      report_path: z.string().optional(),
      summary: z
        .object({
          wp_core_outdated: z.boolean(),
          outdated_plugin_count: z.number().int().nonnegative(),
          outdated_theme_count: z.number().int().nonnegative(),
          weak_admin_count: z.number().int().nonnegative(),
          wp_debug_on: z.boolean(),
        })
        .optional(),
    }),
  ),
  consolidated_path: z.string(),
});
export type AuditManyOutput = z.infer<typeof AuditManyOutputSchema>;

export const MigrateDataInputSchema = z.object({
  source_target_id: TargetIdSchema,
  dest_target_id: TargetIdSchema,
  scope: z.enum(["plugin_versions"]).default("plugin_versions"),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type MigrateDataInput = z.infer<typeof MigrateDataInputSchema>;

export const MigrateDataOutputSchema = z.object({
  run_id: RunIdShape,
  scope: z.string(),
  applied: z.array(
    z.object({
      action: z.enum(["install", "upgrade", "downgrade", "noop"]),
      slug: z.string(),
      from: z.string().optional(),
      to: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
  report_path: z.string(),
});
export type MigrateDataOutput = z.infer<typeof MigrateDataOutputSchema>;

// ---------------------------------------------------------------------------
// Companion-gated power tools — v0.2 (W-003R, W-004R)
// ---------------------------------------------------------------------------

export const ExecutePhpInputSchema = z.object({
  target_id: TargetIdSchema,
  payload: z.string().min(1),
  timeout_ms: z.number().int().min(100).max(30_000).default(5000),
  confirm: ConfirmTrueSchema,
});
export type ExecutePhpInput = z.infer<typeof ExecutePhpInputSchema>;

export const ExecutePhpOutputSchema = z.object({
  ok: z.boolean(),
  return_value: z.unknown().optional(),
  stdout: z.string().optional(),
  duration_ms: z.number().optional(),
  php_warnings: z.array(z.string()).optional(),
  audit_id: z.string(),
  error_message: z.string().optional(),
});
export type ExecutePhpOutput = z.infer<typeof ExecutePhpOutputSchema>;

// ---------------------------------------------------------------------------
// Site-owned skills — CPT-backed playbooks (companion v2.13+). Mutations are
// recoverable (CPT revisions + trash), so no confirm gate.
// ---------------------------------------------------------------------------

const SkillCatalogEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  enable_agentic: z.boolean(),
  enable_prompt: z.boolean(),
});

export const SkillCatalogInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type SkillCatalogInput = z.infer<typeof SkillCatalogInputSchema>;

export const SkillCatalogOutputSchema = z.object({
  skills: z.array(SkillCatalogEntrySchema),
});
export type SkillCatalogOutput = z.infer<typeof SkillCatalogOutputSchema>;

export const SkillGetInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
});
export type SkillGetInput = z.infer<typeof SkillGetInputSchema>;

export const SkillGetOutputSchema = z.object({
  found: z.boolean(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  skill_md: z.string().optional(),
  enable_agentic: z.boolean().optional(),
  enable_prompt: z.boolean().optional(),
});
export type SkillGetOutput = z.infer<typeof SkillGetOutputSchema>;

export const SkillWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  title: z.string().min(1),
  description: z.string().default(""),
  content: z.string().min(1),
  enable_agentic: z.boolean().optional(),
  enable_prompt: z.boolean().optional(),
  on_conflict: z.enum(["fail", "replace", "rename"]).default("fail"),
});
export type SkillWriteInput = z.infer<typeof SkillWriteInputSchema>;

export const SkillWriteOutputSchema = z.object({
  slug: z.string(),
  action: z.string(),
  warnings: z.array(z.string()),
  audit_id: z.string(),
});
export type SkillWriteOutput = z.infer<typeof SkillWriteOutputSchema>;

export const SkillEditInputSchema = z
  .object({
    target_id: TargetIdSchema,
    slug: z.string().min(1),
    description: z.string().optional(),
    content: z.string().optional(),
    enable_agentic: z.boolean().optional(),
    enable_prompt: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.description !== undefined ||
      v.content !== undefined ||
      v.enable_agentic !== undefined ||
      v.enable_prompt !== undefined,
    { message: "At least one field to patch is required." },
  );
export type SkillEditInput = z.infer<typeof SkillEditInputSchema>;

export const SkillEditOutputSchema = z.object({
  slug: z.string(),
  action: z.string(),
  skill: z.unknown().nullable().optional(),
  audit_id: z.string(),
});
export type SkillEditOutput = z.infer<typeof SkillEditOutputSchema>;

export const SkillDeleteInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
});
export type SkillDeleteInput = z.infer<typeof SkillDeleteInputSchema>;

export const SkillDeleteOutputSchema = z.object({
  slug: z.string(),
  action: z.string(),
  recoverable: z.boolean(),
  audit_id: z.string(),
});
export type SkillDeleteOutput = z.infer<typeof SkillDeleteOutputSchema>;

export const IntrospectInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["hooks", "transients", "options_full", "request_state"]),
  include_values: z.boolean().default(false),
});
export type IntrospectInput = z.infer<typeof IntrospectInputSchema>;

export const IntrospectOutputSchema = z.object({
  scope: z.string(),
  report: z.unknown(),
});
export type IntrospectOutput = z.infer<typeof IntrospectOutputSchema>;

export const HookStateInputSchema = z.object({
  target_id: TargetIdSchema,
  hook: z.string().min(1),
  kind: z.enum(["action", "filter"]).default("action"),
});
export type HookStateInput = z.infer<typeof HookStateInputSchema>;

export const HookStateOutputSchema = z.object({
  hook: z.string(),
  kind: z.enum(["action", "filter"]),
  callbacks: z.array(
    z.object({
      priority: z.number().int(),
      callback_identifier: z.string(),
    }),
  ),
});
export type HookStateOutput = z.infer<typeof HookStateOutputSchema>;

// ---------------------------------------------------------------------------
// Memory tools — W-028, v0.2
// ---------------------------------------------------------------------------

export const MemoryRecallInputSchema = z.object({
  target_id: TargetIdSchema,
  query: z.string().optional(),
  kind: z.enum(["note", "convention", "runbook", "all"]).default("all"),
});
export type MemoryRecallInput = z.infer<typeof MemoryRecallInputSchema>;

export const MemoryRecallOutputSchema = z.object({
  site_slug: z.string(),
  summary: z.string(),
  notes: z.array(
    z.object({
      kind: z.enum(["note", "convention", "runbook"]),
      name: z.string(),
      content: z.string(),
      written_at: z.string(),
    }),
  ),
});
export type MemoryRecallOutput = z.infer<typeof MemoryRecallOutputSchema>;

export const MemoryNoteInputSchema = z.object({
  target_id: TargetIdSchema,
  content: z.string().min(1),
  kind: z.enum(["note", "convention", "runbook"]).default("note"),
  runbook_name: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type MemoryNoteInput = z.infer<typeof MemoryNoteInputSchema>;

export const MemoryNoteOutputSchema = z.object({
  saved_at: z.string(),
  file_path: z.string(),
  site_slug: z.string(),
});
export type MemoryNoteOutput = z.infer<typeof MemoryNoteOutputSchema>;

export const MemoryListInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type MemoryListInput = z.infer<typeof MemoryListInputSchema>;

export const MemoryListOutputSchema = z.object({
  site_slug: z.string(),
  files: z.array(
    z.object({
      kind: z.enum(["meta", "site", "note", "convention", "runbook"]),
      name: z.string(),
      size_bytes: z.number().int().nonnegative(),
      mtime: z.string(),
    }),
  ),
  total_bytes: z.number().int().nonnegative(),
});
export type MemoryListOutput = z.infer<typeof MemoryListOutputSchema>;

// ---------------------------------------------------------------------------
// Adapters — Elementor / WooCommerce / ACF (read-only, v0.1, W-023)
// ---------------------------------------------------------------------------

export const ElementorReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Single page to dump; omit to list."),
  type: z.string().default("page").describe("Post type to query when listing."),
  per_page: z.number().int().min(1).max(100).default(50),
});
export type ElementorReadInput = z.infer<typeof ElementorReadInputSchema>;

export const ElementorReadOutputSchema = z.object({
  mode: z.enum(["list", "page"]),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
});
export type ElementorReadOutput = z.infer<typeof ElementorReadOutputSchema>;

export const WooReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum([
    "products",
    "orders",
    "settings_groups",
    "settings_in_group",
    "shipping_zones",
    "payment_gateways",
  ]),
  group: z
    .string()
    .optional()
    .describe("Required when scope=settings_in_group"),
  per_page: z.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.string().optional(),
});
export type WooReadInput = z.infer<typeof WooReadInputSchema>;

export const WooReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  items: z.array(z.unknown()),
});
export type WooReadOutput = z.infer<typeof WooReadOutputSchema>;

export const AcfReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["field_groups", "fields_in_group", "post_meta"]),
  group_key: z
    .string()
    .optional()
    .describe("Required when scope=fields_in_group"),
  post_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Required when scope=post_meta"),
});
export type AcfReadInput = z.infer<typeof AcfReadInputSchema>;

export const AcfReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  items: z.array(z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type AcfReadOutput = z.infer<typeof AcfReadOutputSchema>;

// --- Adapter writes (v0.2) ---

export const ElementorWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  widget_tree: z.array(z.unknown()),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type ElementorWriteInput = z.infer<typeof ElementorWriteInputSchema>;

export const ElementorWriteOutputSchema = z.object({
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type ElementorWriteOutput = z.infer<typeof ElementorWriteOutputSchema>;

export const WooWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  op: z.enum(["update_product", "bulk_update_prices"]),
  product_id: z.number().int().positive().optional(),
  fields: JsonObjectSchema.optional(),
  price_updates: z
    .array(
      z.object({
        id: z.number().int().positive(),
        regular_price: z.string().optional(),
        sale_price: z.string().optional(),
      }),
    )
    .optional(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type WooWriteInput = z.infer<typeof WooWriteInputSchema>;

export const WooWriteOutputSchema = z.object({
  op: z.string(),
  result: z.unknown(),
});
export type WooWriteOutput = z.infer<typeof WooWriteOutputSchema>;

export const AcfWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  field_name: z.string().min(1),
  value: z.unknown(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type AcfWriteInput = z.infer<typeof AcfWriteInputSchema>;

export const AcfWriteOutputSchema = z.object({
  source: z.enum(["rest_acf_pro", "wp_cli"]),
  post_id: z.number().int().positive(),
  field_name: z.string(),
});
export type AcfWriteOutput = z.infer<typeof AcfWriteOutputSchema>;

// --- Bricks read (v0.2) ---

export const BricksReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z.number().int().positive().optional(),
  type: z.string().default("page"),
  per_page: z.number().int().min(1).max(100).default(50),
});
export type BricksReadInput = z.infer<typeof BricksReadInputSchema>;

export const BricksReadOutputSchema = z.object({
  mode: z.enum(["list", "page"]),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
});
export type BricksReadOutput = z.infer<typeof BricksReadOutputSchema>;

// --- v0.3 adapters: WPML / Yoast / Rank Math ---

export const WpmlReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["languages", "string_translations", "post_translations"]),
  domain: z.string().optional(),
  post_id: z.number().int().positive().optional(),
});
export type WpmlReadInput = z.infer<typeof WpmlReadInputSchema>;

export const WpmlReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  data: z.unknown(),
});
export type WpmlReadOutput = z.infer<typeof WpmlReadOutputSchema>;

export const YoastReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["post_meta", "settings"]),
  post_id: z.number().int().positive().optional(),
});
export type YoastReadInput = z.infer<typeof YoastReadInputSchema>;

export const YoastReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  data: z.unknown(),
});
export type YoastReadOutput = z.infer<typeof YoastReadOutputSchema>;

export const RankMathReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["post_meta", "settings"]),
  post_id: z.number().int().positive().optional(),
});
export type RankMathReadInput = z.infer<typeof RankMathReadInputSchema>;

export const RankMathReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  data: z.unknown(),
});
export type RankMathReadOutput = z.infer<typeof RankMathReadOutputSchema>;

// ---------------------------------------------------------------------------
// v1.2 — One-click pair (companion-minted App Password via pair_token redeem)
// ---------------------------------------------------------------------------

export const PairInputSchema = z.object({
  siteurl: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://"), {
      message:
        "siteurl must use https:// — pair token MUST NOT traverse plaintext",
    }),
  pair_token: z.string().regex(/^rolepod_wp_pair_[a-f0-9]{48}$/, {
    message:
      'pair_token must match the companion-issued format "rolepod_wp_pair_<48 hex>"',
  }),
});
export type PairInput = z.infer<typeof PairInputSchema>;

export const PairOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string().url(),
  username: z.string(),
  capabilities: z.array(z.string()),
  companion_version: z.string(),
  is_production: z.boolean(),
  prod_guard: ProdGuardStatusSchema.optional(),
  app_password_name: z
    .string()
    .describe(
      "Name of the WP Application Password the companion minted; visible + revocable from profile.php",
    ),
  credential_stored: z
    .boolean()
    .describe(
      "True if the App Password was stored in the local vault for reuse",
    ),
});
export type PairOutput = z.infer<typeof PairOutputSchema>;

// ---------------------------------------------------------------------------
// v1.1 Tier A — Divi / Oxygen / Bricks-write / Yoast-write / RankMath-write / WPML-write
// ---------------------------------------------------------------------------

export const DiviReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z.number().int().positive().optional(),
  type: z.string().default("page"),
  per_page: z.number().int().min(1).max(100).default(50),
});
export type DiviReadInput = z.infer<typeof DiviReadInputSchema>;

export const DiviReadOutputSchema = z.object({
  mode: z.enum(["list", "page"]),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
});
export type DiviReadOutput = z.infer<typeof DiviReadOutputSchema>;

export const DiviWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  content: z
    .string()
    .min(1)
    .describe("Full Divi shortcode string for post_content"),
  ensure_builder_flag: z
    .boolean()
    .default(true)
    .describe("Set _et_pb_use_builder=on if not already"),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type DiviWriteInput = z.infer<typeof DiviWriteInputSchema>;

export const DiviWriteOutputSchema = z.object({
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type DiviWriteOutput = z.infer<typeof DiviWriteOutputSchema>;

export const OxygenReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z.number().int().positive().optional(),
  type: z.string().default("page"),
  per_page: z.number().int().min(1).max(100).default(50),
});
export type OxygenReadInput = z.infer<typeof OxygenReadInputSchema>;

export const OxygenReadOutputSchema = z.object({
  mode: z.enum(["list", "page"]),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
});
export type OxygenReadOutput = z.infer<typeof OxygenReadOutputSchema>;

export const OxygenWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  shortcodes: z.string().min(1),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type OxygenWriteInput = z.infer<typeof OxygenWriteInputSchema>;

export const OxygenWriteOutputSchema = z.object({
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type OxygenWriteOutput = z.infer<typeof OxygenWriteOutputSchema>;

export const BricksWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  scope: z.enum(["page", "header", "footer"]).default("page"),
  elements: z.array(z.unknown()),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type BricksWriteInput = z.infer<typeof BricksWriteInputSchema>;

export const BricksWriteOutputSchema = z.object({
  scope: z.enum(["page", "header", "footer"]),
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type BricksWriteOutput = z.infer<typeof BricksWriteOutputSchema>;

export const YoastWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  focus_keyword: z.string().optional(),
  meta_description: z.string().optional(),
  title: z.string().optional(),
  canonical: z.string().optional(),
  noindex: z.boolean().optional(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type YoastWriteInput = z.infer<typeof YoastWriteInputSchema>;

export const YoastWriteOutputSchema = z.object({
  post_id: z.number().int().positive(),
  updated_fields: z.array(z.string()),
  source: z.enum(["wp_cli"]),
});
export type YoastWriteOutput = z.infer<typeof YoastWriteOutputSchema>;

export const RankMathWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  focus_keyword: z.string().optional(),
  meta_description: z.string().optional(),
  title: z.string().optional(),
  canonical: z.string().optional(),
  noindex: z.boolean().optional(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type RankMathWriteInput = z.infer<typeof RankMathWriteInputSchema>;

export const RankMathWriteOutputSchema = z.object({
  post_id: z.number().int().positive(),
  updated_fields: z.array(z.string()),
  source: z.enum(["wp_cli"]),
});
export type RankMathWriteOutput = z.infer<typeof RankMathWriteOutputSchema>;

export const WpmlWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  op: z.enum([
    "set_post_language",
    "link_translations",
    "duplicate_for_translation",
  ]),
  post_id: z.number().int().positive().optional(),
  original_post_id: z.number().int().positive().optional(),
  language_code: z.string().min(2).max(10).optional(),
  target_language: z.string().min(2).max(10).optional(),
  translations: z.record(z.string(), z.number().int().positive()).optional(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type WpmlWriteInput = z.infer<typeof WpmlWriteInputSchema>;

export const WpmlWriteOutputSchema = z.object({
  op: z.string(),
  source: z.enum(["wp_cli", "rest"]),
  result: z.unknown(),
});
export type WpmlWriteOutput = z.infer<typeof WpmlWriteOutputSchema>;

// ---------------------------------------------------------------------------
// v1.1 Tier B — Forms / Cron / Cache / Mail / Clone / Backup
// ---------------------------------------------------------------------------

export const FormsReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(["list_forms", "list_entries", "form_detail"]),
  engine: z.enum(["auto", "gravity", "cf7", "wpforms"]).default("auto"),
  form_id: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
  per_page: z.number().int().min(1).max(200).default(50),
});
export type FormsReadInput = z.infer<typeof FormsReadInputSchema>;

export const FormsReadOutputSchema = z.object({
  scope: z.string(),
  engine_used: z.enum(["gravity", "cf7", "wpforms", "none"]),
  detected: z.boolean(),
  items: z.array(z.unknown()).optional(),
  form: z.unknown().optional(),
});
export type FormsReadOutput = z.infer<typeof FormsReadOutputSchema>;

export const FormsWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  engine: z.enum(["gravity", "cf7", "wpforms"]),
  op: z.enum(["delete_entry", "mark_spam", "unmark_spam"]),
  entry_id: z.number().int().positive(),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type FormsWriteInput = z.infer<typeof FormsWriteInputSchema>;

export const FormsWriteOutputSchema = z.object({
  op: z.string(),
  entry_id: z.number().int().positive(),
  source: z.enum(["rest", "wp_cli"]),
});
export type FormsWriteOutput = z.infer<typeof FormsWriteOutputSchema>;

export const CronToolInputSchema = z.object({
  target_id: TargetIdSchema,
  op: z.enum(["list", "run", "delete"]),
  hook: z.string().optional().describe("Required when op=run or op=delete"),
  confirm: z.boolean().default(false),
});
export type CronToolInput = z.infer<typeof CronToolInputSchema>;

export const CronToolOutputSchema = z.object({
  op: z.string(),
  events: z
    .array(
      z.object({
        hook: z.string(),
        next_run_relative: z.string(),
        next_run_gmt: z.string(),
        recurrence: z.string(),
      }),
    )
    .optional(),
  ran: z.array(z.string()).optional(),
  deleted_count: z.number().int().nonnegative().optional(),
});
export type CronToolOutput = z.infer<typeof CronToolOutputSchema>;

export const CacheToolInputSchema = z.object({
  target_id: TargetIdSchema,
  op: z.enum(["inspect", "flush_object", "flush_transients"]),
  confirm: z.boolean().default(false),
});
export type CacheToolInput = z.infer<typeof CacheToolInputSchema>;

export const CacheToolOutputSchema = z.object({
  op: z.string(),
  object_cache_active: z.boolean().optional(),
  transient_count: z.number().int().nonnegative().optional(),
  expired_transient_count: z.number().int().nonnegative().optional(),
  flushed: z.boolean().optional(),
});
export type CacheToolOutput = z.infer<typeof CacheToolOutputSchema>;

export const MailTestInputSchema = z.object({
  target_id: TargetIdSchema,
  to: z.string().email(),
  subject: z.string().default("rolepod-wplab mail test"),
  body: z
    .string()
    .default("Test message from rolepod-wplab v1.1 mail-test tool."),
  confirm: ConfirmTrueSchema,
});
export type MailTestInput = z.infer<typeof MailTestInputSchema>;

export const MailTestOutputSchema = z.object({
  to: z.string(),
  delivered: z.boolean(),
  source: z.enum(["companion_php", "wp_cli_eval"]),
  detail: z.string().optional(),
});
export type MailTestOutput = z.infer<typeof MailTestOutputSchema>;

export const CloneInputSchema = z.object({
  source_target_id: TargetIdSchema,
  dest_target_id: TargetIdSchema,
  scope: z
    .array(z.enum(["db", "wp_content", "plugin_versions"]))
    .default(["db", "wp_content", "plugin_versions"]),
  rewrite_urls: z.boolean().default(true),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type CloneInput = z.infer<typeof CloneInputSchema>;

export const CloneOutputSchema = z.object({
  run_id: RunIdShape,
  steps: z.array(
    z.object({
      step: z.string(),
      ok: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
  report_path: z.string(),
});
export type CloneOutput = z.infer<typeof CloneOutputSchema>;

export const BackupCreateInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.array(z.enum(["db", "wp_content"])).default(["db", "wp_content"]),
  label: z.string().optional(),
});
export type BackupCreateInput = z.infer<typeof BackupCreateInputSchema>;

export const BackupCreateOutputSchema = z.object({
  run_id: RunIdShape,
  artifact_dir: z.string(),
  artifacts: z.array(
    z.object({
      kind: z.enum(["db", "wp_content"]),
      path: z.string(),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});
export type BackupCreateOutput = z.infer<typeof BackupCreateOutputSchema>;

export const BackupRestoreInputSchema = z.object({
  target_id: TargetIdSchema,
  artifact_dir: z.string().min(1),
  scope: z.array(z.enum(["db", "wp_content"])).default(["db", "wp_content"]),
  allow_destructive: ConfirmTrueSchema,
  confirm: z.boolean().default(false),
});
export type BackupRestoreInput = z.infer<typeof BackupRestoreInputSchema>;

export const BackupRestoreOutputSchema = z.object({
  run_id: RunIdShape,
  restored: z.array(
    z.object({
      kind: z.enum(["db", "wp_content"]),
      ok: z.boolean(),
      detail: z.string().optional(),
    }),
  ),
});
export type BackupRestoreOutput = z.infer<typeof BackupRestoreOutputSchema>;

// ---------------------------------------------------------------------------
// v1.1 Tier D — User sessions / REST dump / Pattern scaffold / Diagnose
// ---------------------------------------------------------------------------

export const UserSessionListInputSchema = z.object({
  target_id: TargetIdSchema,
  per_page: z.number().int().min(1).max(200).default(50),
});
export type UserSessionListInput = z.infer<typeof UserSessionListInputSchema>;

export const UserSessionListOutputSchema = z.object({
  total_users_with_sessions: z.number().int().nonnegative(),
  sessions: z.array(
    z.object({
      user_id: z.number().int().positive(),
      user_login: z.string(),
      token_count: z.number().int().nonnegative(),
      tokens: z
        .array(
          z.object({
            login_ip: z.string().optional(),
            ua: z.string().optional(),
            login_time_gmt: z.string().optional(),
            expiration_gmt: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
});
export type UserSessionListOutput = z.infer<typeof UserSessionListOutputSchema>;

export const RestDumpInputSchema = z.object({
  target_id: TargetIdSchema,
  filter_namespace: z
    .string()
    .optional()
    .describe('Only include routes under this namespace, e.g. "wc/v3"'),
});
export type RestDumpInput = z.infer<typeof RestDumpInputSchema>;

export const RestDumpOutputSchema = z.object({
  namespaces: z.array(z.string()),
  route_count: z.number().int().nonnegative(),
  routes: z.array(
    z.object({
      path: z.string(),
      namespace: z.string(),
      methods: z.array(z.string()),
    }),
  ),
});
export type RestDumpOutput = z.infer<typeof RestDumpOutputSchema>;

export const ScaffoldPatternInputSchema = z.object({
  target_id: TargetIdSchema,
  host: z.enum(["theme", "plugin"]),
  host_slug: z.string().min(1),
  pattern_slug: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/, {
    message: 'pattern_slug must be namespaced like "my-theme/cta-card"',
  }),
  title: z.string().min(1),
  description: z.string().optional(),
  categories: z.array(z.string()).default(["featured"]),
  content: z
    .string()
    .min(1)
    .describe(
      "Block markup body — pasted as-is between header comment and closing",
    ),
  allow_destructive: ConfirmTrueSchema,
});
export type ScaffoldPatternInput = z.infer<typeof ScaffoldPatternInputSchema>;

export const ScaffoldPatternOutputSchema = z.object({
  run_id: RunIdShape,
  file_written: z.string(),
});
export type ScaffoldPatternOutput = z.infer<typeof ScaffoldPatternOutputSchema>;

export const DiagnoseInputSchema = z.object({
  target_id: TargetIdSchema,
  scopes: z
    .array(
      z.enum([
        "plugin_conflict_probe",
        "slow_queries",
        "large_options",
        "broken_images",
        "php_errors",
      ]),
    )
    .default([
      "plugin_conflict_probe",
      "slow_queries",
      "large_options",
      "php_errors",
    ]),
  report_format: z.enum(["markdown", "json"]).default("markdown"),
});
export type DiagnoseInput = z.infer<typeof DiagnoseInputSchema>;

export const DiagnoseOutputSchema = z.object({
  run_id: RunIdShape,
  findings: z.array(
    z.object({
      scope: z.string(),
      severity: z.enum(["info", "warn", "critical"]),
      message: z.string(),
      detail: z.unknown().optional(),
    }),
  ),
  report_path: z.string(),
});
export type DiagnoseOutput = z.infer<typeof DiagnoseOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_file_read
// ---------------------------------------------------------------------------

export const WpFileReadInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1).describe("Path relative to WP install root"),
  offset: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "1-based start line. With limit, returns a line range — use for large files instead of reading the whole thing.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max lines from offset (default: to end of file)."),
  grep: z
    .string()
    .optional()
    .describe(
      "Regex — return only matching lines (plus `context` lines around each). Cheaper than reading a 30 KB+ file to find a few lines.",
    ),
  context: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe("Lines of context around each grep match."),
  ignore_case: z.boolean().default(false).describe("Case-insensitive grep."),
  max_bytes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Cap returned bytes (truncates the sliced result). Prevents blowing the response token budget on huge files.",
    ),
});
export type WpFileReadInput = z.infer<typeof WpFileReadInputSchema>;

export const WpFileReadOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  bytes: z
    .number()
    .int()
    .nonnegative()
    .describe("Byte length of the FULL file."),
  returned_bytes: z.number().int().nonnegative().optional(),
  truncated: z
    .boolean()
    .optional()
    .describe("True when max_bytes cut the result."),
  matched_lines: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("grep mode: lines matched."),
});
export type WpFileReadOutput = z.infer<typeof WpFileReadOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_file_write
// ---------------------------------------------------------------------------

export const WpFileWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1).describe("Path relative to WP install root"),
  content: z.string(),
  mode: z.enum(["overwrite", "append"]).default("overwrite"),
  backup: z.boolean().default(true),
  confirm_unsafe_path: z.boolean().default(false),
});
export type WpFileWriteInput = z.infer<typeof WpFileWriteInputSchema>;

export const WpFileWriteOutputSchema = z.object({
  path: z.string(),
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
});
export type WpFileWriteOutput = z.infer<typeof WpFileWriteOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_target_alias (v1.14 — persistent target aliases)
// ---------------------------------------------------------------------------

export const TargetAliasInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    alias: z.string().regex(/^[a-z][a-z0-9_-]{0,30}$/, {
      message:
        "alias must be lowercase letters/digits/_/- starting with a letter (e.g. 'demo', 'staging-1')",
    }),
    siteurl: z
      .string()
      .url()
      .refine((u) => u.startsWith("https://"), {
        message: "siteurl must use https://",
      }),
    credential_ref: z
      .string()
      .optional()
      .describe(
        "Override credentials vault lookup key. Defaults to canonical hostname of siteurl.",
      ),
  }),
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("rm"),
    alias: z.string(),
  }),
  z.object({
    action: z.literal("resolve"),
    alias: z.string(),
  }),
]);
export type TargetAliasInput = z.infer<typeof TargetAliasInputSchema>;

export const TargetAliasOutputSchema = z.object({
  action: z.enum(["set", "list", "rm", "resolve"]),
  alias: z.string().optional(),
  siteurl: z.string().optional(),
  credential_ref: z.string().optional(),
  target_id: z.string().optional(),
  removed: z.boolean().optional(),
  aliases: z
    .array(
      z.object({
        alias: z.string(),
        siteurl: z.string(),
        credential_ref: z.string(),
        added_at: z.string(),
        last_used_at: z.string().optional(),
      }),
    )
    .optional(),
});
export type TargetAliasOutput = z.infer<typeof TargetAliasOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_file_write_batch (v1.15 — Phase 2 atomic multi-file write)
// ---------------------------------------------------------------------------

export const WpFileWriteBatchInputSchema = z.object({
  target_id: TargetIdSchema,
  writes: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
        mode: z.enum(["overwrite", "append"]).default("overwrite"),
        confirm_unsafe_path: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
  skip_php_lint: z.boolean().default(false),
});
export type WpFileWriteBatchInput = z.infer<typeof WpFileWriteBatchInputSchema>;

export const WpFileWriteBatchOutputSchema = z.object({
  batch_id: z.string(),
  written: z.array(
    z.object({
      path: z.string(),
      absolute_path: z.string(),
      bytes_written: z.number().int().nonnegative(),
      backup_path: z.string().nullable(),
    }),
  ),
  preflight: z.object({
    php_lint_ran: z.boolean(),
    require_chain_ran: z.boolean(),
    entries_scanned: z.number().int().nonnegative(),
  }),
});
export type WpFileWriteBatchOutput = z.infer<
  typeof WpFileWriteBatchOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_dir_ensure
// ---------------------------------------------------------------------------

export const WpDirEnsureInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1),
});
export type WpDirEnsureInput = z.infer<typeof WpDirEnsureInputSchema>;

export const WpDirEnsureOutputSchema = z.object({
  path: z.string(),
  absolute_path: z.string(),
  created: z.boolean(),
});
export type WpDirEnsureOutput = z.infer<typeof WpDirEnsureOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_file_copy
// ---------------------------------------------------------------------------

export const WpFileCopyInputSchema = z.object({
  target_id: TargetIdSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  overwrite: z.boolean().default(false),
});
export type WpFileCopyInput = z.infer<typeof WpFileCopyInputSchema>;

export const WpFileCopyOutputSchema = z.object({
  from: z.string(),
  to: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type WpFileCopyOutput = z.infer<typeof WpFileCopyOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_file_list
// ---------------------------------------------------------------------------

export const WpFileListInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1),
  depth: z.number().int().min(0).max(5).default(2),
  include_hidden: z.boolean().default(false),
});
export type WpFileListInput = z.infer<typeof WpFileListInputSchema>;

export const WpFileListOutputSchema = z.object({
  root: z.string(),
  truncated: z.boolean(),
  entries: z.array(
    z.object({
      path: z.string(),
      type: z.enum(["file", "dir"]),
      bytes: z.number().int().nonnegative(),
      mtime: z.number().int().nonnegative(),
      depth: z.number().int().nonnegative(),
    }),
  ),
});
export type WpFileListOutput = z.infer<typeof WpFileListOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_widget_schema
// ---------------------------------------------------------------------------

export const WpElementorWidgetSchemaInputSchema = z.object({
  target_id: TargetIdSchema,
  widget: z
    .string()
    .optional()
    .describe(
      "Widget type name (e.g. 'heading', 'button', 'counter', 'accordion'). Omit to list every registered widget type.",
    ),
});
export type WpElementorWidgetSchemaInput = z.infer<
  typeof WpElementorWidgetSchemaInputSchema
>;

export const WpElementorWidgetSchemaOutputSchema = z
  .object({
    ok: z.boolean(),
    elementor_version: z.string(),
  })
  .passthrough();
export type WpElementorWidgetSchemaOutput = z.infer<
  typeof WpElementorWidgetSchemaOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_template_export
// ---------------------------------------------------------------------------

export const WpElementorTemplateExportInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
});
export type WpElementorTemplateExportInput = z.infer<
  typeof WpElementorTemplateExportInputSchema
>;

export const WpElementorTemplateExportOutputSchema = z
  .object({
    ok: z.boolean(),
    post_id: z.number().int(),
  })
  .passthrough();
export type WpElementorTemplateExportOutput = z.infer<
  typeof WpElementorTemplateExportOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_publish (v1.16 — one-shot flush chain)
// ---------------------------------------------------------------------------

export const WpElementorPublishInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  warm_cache: z
    .boolean()
    .default(true)
    .describe(
      "After flushing, fetch the post's permalink once so the Varnish/CDN layer pre-caches a hot copy. Disable to save the round trip when you'll be editing again before viewing.",
    ),
  bump_theme_assets: z
    .boolean()
    .default(true)
    .describe(
      "Bump filemtime() on every *.css and *.js under the active theme's assets/ dir. The enqueue layer derives the asset ?ver= query string from filemtime, so this forces brand-new query strings and busts the browser/CDN cache that would otherwise keep serving the old CSS body even after the file content changed. Disable only when you know nothing under assets/ was touched this round.",
    ),
});
export type WpElementorPublishInput = z.infer<
  typeof WpElementorPublishInputSchema
>;

export const WpElementorPublishOutputSchema = z.object({
  post_id: z.number().int(),
  permalink: z.string().url(),
  elementor_flush: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  object_cache_flush: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  theme_assets_bumped: z
    .object({
      ok: z.boolean(),
      files_touched: z.number().int().nonnegative(),
      theme_dir: z.string(),
    })
    .optional(),
  warm_fetch: z
    .object({
      ok: z.boolean(),
      status: z.number().int(),
      bytes: z.number().int().nonnegative(),
      duration_ms: z.number().int().nonnegative(),
    })
    .optional(),
});
export type WpElementorPublishOutput = z.infer<
  typeof WpElementorPublishOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_validate_data (v1.16 — schema-driven JSON validation)
// ---------------------------------------------------------------------------

export const WpElementorValidateDataInputSchema = z.object({
  target_id: TargetIdSchema,
  sections: z
    .array(z.record(z.string(), z.unknown()))
    .describe(
      "Same shape as `_elementor_data`: an array of section objects with elements: [{ widgetType, settings, ... }] nested inside columns.",
    ),
  strict: z
    .boolean()
    .default(false)
    .describe(
      "When true, unknown settings raise errors. Default: unknown settings are warnings (some control names vary across Elementor versions and you may want to tolerate that).",
    ),
});
export type WpElementorValidateDataInput = z.infer<
  typeof WpElementorValidateDataInputSchema
>;

export const WpElementorValidateDataOutputSchema = z.object({
  ok: z.boolean(),
  widgets_scanned: z.number().int().nonnegative(),
  widget_types_seen: z.array(z.string()),
  errors: z.array(
    z.object({
      widget_id: z.string(),
      widget_type: z.string(),
      setting_key: z.string(),
      reason: z.string(),
      expected_type: z.string().optional(),
      actual_type: z.string().optional(),
    }),
  ),
  warnings: z.array(
    z.object({
      widget_id: z.string(),
      widget_type: z.string(),
      setting_key: z.string(),
      reason: z.string(),
    }),
  ),
});
export type WpElementorValidateDataOutput = z.infer<
  typeof WpElementorValidateDataOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_widget_attribute (v1.17 — companion-side data-* rehydrate)
// ---------------------------------------------------------------------------

export const WpElementorWidgetAttributeInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  widget_id: z.string().regex(/^[a-z0-9]{4,16}$/i, {
    message: "widget_id must be 4-16 alphanumeric chars (Elementor element id)",
  }),
  attrs: z
    .record(z.string(), z.string())
    .describe(
      "Map of attribute name (without `data-` prefix) → value. Pass an empty object to clear all attrs for this widget.",
    ),
});
export type WpElementorWidgetAttributeInput = z.infer<
  typeof WpElementorWidgetAttributeInputSchema
>;

export const WpElementorWidgetAttributeOutputSchema = z.object({
  post_id: z.number().int(),
  widget_id: z.string(),
  attrs_now: z.record(z.string(), z.string()),
  widgets_total: z.number().int().nonnegative(),
});
export type WpElementorWidgetAttributeOutput = z.infer<
  typeof WpElementorWidgetAttributeOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_template_apply
// ---------------------------------------------------------------------------

export const WpElementorTemplateApplyInputSchema = z.object({
  target_id: TargetIdSchema,
  target_post_id: z.number().int().positive(),
  sections: z.array(z.record(z.string(), z.unknown())).min(1),
  replace_strings: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      "Optional map of literal find→replace pairs applied to the JSON-encoded sections before commit. Use for swapping per-clone strings (page titles, button labels, post IDs).",
    ),
  overwrite: z.boolean().default(false),
});
export type WpElementorTemplateApplyInput = z.infer<
  typeof WpElementorTemplateApplyInputSchema
>;

export const WpElementorTemplateApplyOutputSchema = z.object({
  target_post_id: z.number().int(),
  section_count: z.number().int().nonnegative(),
  replacements_applied: z.number().int().nonnegative(),
});
export type WpElementorTemplateApplyOutput = z.infer<
  typeof WpElementorTemplateApplyOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_job_create / rolepod_wp_job_status (v1.17 — async wp-cli)
// ---------------------------------------------------------------------------

export const WpJobCreateInputSchema = z.object({
  target_id: TargetIdSchema,
  args: z.array(z.string()).min(1),
  timeout_seconds: z.number().int().min(60).max(3600).default(600),
  allow_destructive: z.boolean().default(false),
});
export type WpJobCreateInput = z.infer<typeof WpJobCreateInputSchema>;

export const WpJobCreateOutputSchema = z.object({
  job_id: z.string(),
  pid: z.number().int(),
  log: z.object({ stdout: z.string(), stderr: z.string() }),
  started_at: z.number().int(),
  ttl_seconds: z.number().int(),
});
export type WpJobCreateOutput = z.infer<typeof WpJobCreateOutputSchema>;

export const WpJobStatusInputSchema = z.object({
  target_id: TargetIdSchema,
  job_id: z.string().regex(/^[a-f0-9]{12}$/),
  tail: z.number().int().min(256).max(65536).default(8192),
});
export type WpJobStatusInput = z.infer<typeof WpJobStatusInputSchema>;

export const WpJobStatusOutputSchema = z.object({
  job_id: z.string(),
  pid: z.number().int(),
  args: z.array(z.string()),
  started_at: z.number().int(),
  state: z.enum(["running", "completed", "failed", "unknown"]),
  elapsed_seconds: z.number().int().nonnegative(),
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  log: z.object({ stdout: z.string(), stderr: z.string() }),
  exit_code: z.number().int().optional(),
});
export type WpJobStatusOutput = z.infer<typeof WpJobStatusOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_media_optimize + rolepod_wp_site_backup / _restore
// (v1.23 — server-side companion engines, throttled in WP via cron)
// ---------------------------------------------------------------------------

export const WpMediaOptimizeInputSchema = z.object({
  target_id: TargetIdSchema,
  mode: z.enum(["immediate", "enqueue"]).default("immediate"),
  apply: z.boolean().default(false),
  min_bytes: z.number().int().min(1).default(200_000),
  max_dimension: z.number().int().min(0).default(0),
  quality: z.number().int().min(1).max(100).default(82),
  limit: z.number().int().min(1).max(100).default(20),
});
export type WpMediaOptimizeInput = z.infer<typeof WpMediaOptimizeInputSchema>;
export const WpMediaOptimizeOutputSchema = z.record(z.unknown());
export type WpMediaOptimizeOutput = z.infer<typeof WpMediaOptimizeOutputSchema>;

export const WpMediaUploadInputSchema = z
  .object({
    target_id: TargetIdSchema,
    source: z.enum(["base64", "url", "local_path"]),
    data: z.string().optional(),
    url: z.string().url().optional(),
    path: z.string().optional(),
    filename: z.string().optional(),
    alt: z.string().optional(),
    title: z.string().optional(),
    caption: z.string().optional(),
    // Sets the attachment's post_parent (companion path). Featured-image use is
    // separate: set_featured writes the post's featured_media (see below).
    attach_to_post: z.number().int().positive().optional(),
    // REST base of the post to feature the image on (e.g. "posts", "pages",
    // or a CPT's rest_base).
    attach_to_post_type: z.string().default("posts"),
    set_featured: z.boolean().default(false),
  })
  // No silent no-op: featuring an image needs to know which post.
  .refine((v) => !v.set_featured || v.attach_to_post !== undefined, {
    message: "set_featured=true requires attach_to_post (the post to feature it on)",
    path: ["set_featured"],
  })
  // Each source needs its matching payload field.
  .refine(
    (v) =>
      (v.source === "base64" && !!v.data) ||
      (v.source === "url" && !!v.url) ||
      (v.source === "local_path" && !!v.path),
    {
      message:
        "source requires its field: base64→data, url→url, local_path→path",
      path: ["source"],
    },
  );
export type WpMediaUploadInput = z.infer<typeof WpMediaUploadInputSchema>;
export const WpMediaUploadOutputSchema = z.record(z.unknown());
export type WpMediaUploadOutput = z.infer<typeof WpMediaUploadOutputSchema>;

const BackupComponentsSchema = z
  .object({
    db: z.boolean().optional(),
    uploads: z.boolean().optional(),
    themes: z.boolean().optional(),
    plugins: z.boolean().optional(),
    muplugins: z.boolean().optional(),
  })
  .optional();

export const WpSiteBackupInputSchema = z.object({
  target_id: TargetIdSchema,
  action: z
    .enum(["start", "status", "list", "inspect", "cancel", "delete"])
    .default("status"),
  components: BackupComponentsSchema,
  compress: z.boolean().optional(),
  exclude: z.array(z.string()).optional(),
  id: z.string().optional(),
  entry: z.string().optional(),
  max_bytes: z.number().int().min(1).max(5_000_000).optional(),
});
export type WpSiteBackupInput = z.infer<typeof WpSiteBackupInputSchema>;
export const WpSiteBackupOutputSchema = z.record(z.unknown());
export type WpSiteBackupOutput = z.infer<typeof WpSiteBackupOutputSchema>;

export const WpSiteRestoreInputSchema = z.object({
  target_id: TargetIdSchema,
  action: z.enum(["start", "status"]).default("status"),
  id: z.string().optional(),
  confirm: z.boolean().default(false),
  components: z
    .object({ db: z.boolean().optional(), files: z.boolean().optional() })
    .optional(),
  search_replace: z.record(z.string()).optional(),
  path_prefix: z.string().optional(),
});
export type WpSiteRestoreInput = z.infer<typeof WpSiteRestoreInputSchema>;
export const WpSiteRestoreOutputSchema = z.record(z.unknown());
export type WpSiteRestoreOutput = z.infer<typeof WpSiteRestoreOutputSchema>;

// ---------------------------------------------------------------------------
// rolepod_wp_custom_* (v1.18 — Rolepod Custom plugin scaffolding)
// ---------------------------------------------------------------------------

export const WpCustomInitInputSchema = z.object({
  target_id: TargetIdSchema,
  activate: z
    .boolean()
    .default(true)
    .describe(
      "Activate the plugin after install (recommended). When false, plugin files are written but stay inactive — useful for staged rollouts.",
    ),
});
export type WpCustomInitInput = z.infer<typeof WpCustomInitInputSchema>;

export const WpCustomInitOutputSchema = z.object({
  plugin_dir: z.string(),
  files_written: z.number().int().nonnegative(),
  was_already_installed: z.boolean(),
  activated: z.boolean(),
});
export type WpCustomInitOutput = z.infer<typeof WpCustomInitOutputSchema>;

const TaskSettingFieldSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  type: z.enum([
    "text",
    "email",
    "url",
    "number",
    "textarea",
    "checkbox",
    "select",
  ]),
  label: z.string().min(1),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  help: z.string().optional(),
  options: z.record(z.string(), z.string()).optional(),
});

export const WpCustomTaskScaffoldInputSchema = z.object({
  target_id: TargetIdSchema,
  task_id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,40}$/, {
      message: "task_id must be kebab-case, lowercase, 2-40 chars",
    })
    .describe(
      "Stable slug identifier — used in option keys, file name, URLs. e.g. 'contact-snippet'.",
    ),
  title: z
    .string()
    .min(1)
    .max(80)
    .describe("Human-readable label shown in the admin menu + Overview page."),
  description: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Why this task exists. Surfaced on the Overview page so the user remembers what each task does.",
    ),
  settings: z
    .array(TaskSettingFieldSchema)
    .default([])
    .describe(
      "Field definitions for the auto-generated settings page. Use [] when the task has no configurable settings.",
    ),
  hooks_body: z
    .string()
    .describe(
      "Raw PHP body of register_hooks(). Should typically start with `if ( ! $this->is_enabled() ) { return; }` then call add_action / add_filter / add_shortcode. Use $this->settings()['<key>'] to read values.",
    ),
  extra_methods: z
    .string()
    .optional()
    .describe(
      "Optional extra PHP methods to append to the task class (callback handlers etc).",
    ),
  auto_init: z
    .boolean()
    .default(true)
    .describe(
      "Run rolepod_wp_custom_init first if the plugin isn't installed yet. Default true so first-task-on-new-site Just Works.",
    ),
});
export type WpCustomTaskScaffoldInput = z.infer<
  typeof WpCustomTaskScaffoldInputSchema
>;

export const WpCustomTaskScaffoldOutputSchema = z.object({
  task_id: z.string(),
  title: z.string(),
  module_path: z.string(),
  bytes_written: z.number().int().nonnegative(),
  plugin_initialized: z.boolean(),
});
export type WpCustomTaskScaffoldOutput = z.infer<
  typeof WpCustomTaskScaffoldOutputSchema
>;

export const WpCustomTaskListInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type WpCustomTaskListInput = z.infer<typeof WpCustomTaskListInputSchema>;

export const WpCustomTaskListOutputSchema = z.object({
  plugin_installed: z.boolean(),
  tasks: z.array(
    z.object({
      task_id: z.string(),
      title: z.string(),
      description: z.string(),
      enabled: z.boolean(),
      module_path: z.string(),
    }),
  ),
});
export type WpCustomTaskListOutput = z.infer<
  typeof WpCustomTaskListOutputSchema
>;

export const WpCustomTaskToggleInputSchema = z.object({
  target_id: TargetIdSchema,
  task_id: z.string(),
  enabled: z
    .boolean()
    .describe(
      "true = enable, false = disable. Toggle is option-based — module file untouched, hooks short-circuit via $this->is_enabled().",
    ),
});
export type WpCustomTaskToggleInput = z.infer<
  typeof WpCustomTaskToggleInputSchema
>;

export const WpCustomTaskToggleOutputSchema = z.object({
  task_id: z.string(),
  enabled: z.boolean(),
});
export type WpCustomTaskToggleOutput = z.infer<
  typeof WpCustomTaskToggleOutputSchema
>;

export const WpCustomTaskUpdateInputSchema = z.object({
  target_id: TargetIdSchema,
  task_id: z.string(),
  title: z
    .string()
    .optional()
    .describe("New human label. Optional — omit to keep existing."),
  description: z.string().optional(),
  settings: z.array(TaskSettingFieldSchema).optional(),
  hooks_body: z.string().optional(),
  extra_methods: z.string().optional(),
});
export type WpCustomTaskUpdateInput = z.infer<
  typeof WpCustomTaskUpdateInputSchema
>;

export const WpCustomTaskUpdateOutputSchema = z.object({
  task_id: z.string(),
  module_path: z.string(),
  bytes_written: z.number().int().nonnegative(),
});
export type WpCustomTaskUpdateOutput = z.infer<
  typeof WpCustomTaskUpdateOutputSchema
>;

export const WpCustomTaskRemoveInputSchema = z.object({
  target_id: TargetIdSchema,
  task_id: z.string(),
  run_uninstall: z
    .boolean()
    .default(true)
    .describe(
      "Call the task's uninstall() method via wp eval before deleting the module file. Default true. Set false if uninstall() is broken and you just want the file gone.",
    ),
});
export type WpCustomTaskRemoveInput = z.infer<
  typeof WpCustomTaskRemoveInputSchema
>;

export const WpCustomTaskRemoveOutputSchema = z.object({
  task_id: z.string(),
  module_path: z.string(),
  uninstall_run: z.boolean(),
  file_deleted: z.boolean(),
});
export type WpCustomTaskRemoveOutput = z.infer<
  typeof WpCustomTaskRemoveOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_builder_detect / rolepod_wp_elementor_html_audit (v1.19 — Phase 6)
// ---------------------------------------------------------------------------

export const WpBuilderDetectInputSchema = z.object({
  target_id: TargetIdSchema,
});
export type WpBuilderDetectInput = z.infer<typeof WpBuilderDetectInputSchema>;

const BuilderSlugSchema = z.enum([
  "elementor",
  "bricks",
  "divi",
  "oxygen",
  "gutenberg",
  "beaver-builder",
  "visual-composer",
  "breakdance",
  "brizy",
]);

export const WpBuilderDetectOutputSchema = z.object({
  active_builders: z.array(
    z.object({
      slug: BuilderSlugSchema,
      version: z.string(),
      capabilities: z.array(z.string()),
      pro: z.boolean(),
      // This MCP server has a read/write adapter for the builder.
      supported: z.boolean(),
      // Whether the adapter can WRITE this builder, not just read it. `false`
      // for a detected-but-unsupported builder so the caller does not promise
      // an edit it cannot make.
      write_support: z.boolean(),
    }),
  ),
  primary: BuilderSlugSchema.nullable(),
});
export type WpBuilderDetectOutput = z.infer<typeof WpBuilderDetectOutputSchema>;

export const WpElementorHtmlAuditInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  threshold_pct: z
    .number()
    .min(0)
    .max(100)
    .default(30)
    .describe(
      "Warn when HTML widget count / total widget count × 100 exceeds this percentage. Default 30. Set to 100 to disable the warning.",
    ),
});
export type WpElementorHtmlAuditInput = z.infer<
  typeof WpElementorHtmlAuditInputSchema
>;

export const WpElementorHtmlAuditOutputSchema = z.object({
  post_id: z.number().int(),
  total_widgets: z.number().int().nonnegative(),
  html_widgets: z.number().int().nonnegative(),
  html_widget_pct: z.number(),
  over_threshold: z.boolean(),
  threshold_pct: z.number(),
  widget_type_counts: z.record(z.string(), z.number()),
  suggestions: z.array(
    z.object({
      widget_id: z.string(),
      reason: z.string(),
      suggested_widget: z.string().optional(),
      suggested_pattern: z.string().optional(),
      fidelity_risk: z
        .enum(["low", "high"])
        .optional()
        .describe(
          "Risk that converting this widget loses design. low = custom CSS reproducible via native style controls if carried over; high = animation/JS with no Elementor-free equivalent.",
        ),
      would_lose: z
        .array(z.string())
        .optional()
        .describe("What a naive native conversion would drop."),
    }),
  ),
  lossy_widgets: z
    .number()
    .int()
    .nonnegative()
    .describe("HTML widgets carrying custom CSS/JS the design depends on."),
  guidance: z
    .string()
    .optional()
    .describe(
      "Directive to extract styling/behaviour before converting. Present when lossy_widgets > 0.",
    ),
});
export type WpElementorHtmlAuditOutput = z.infer<
  typeof WpElementorHtmlAuditOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_section — surgical single-section edit
// ---------------------------------------------------------------------------

export const WpElementorSectionInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  action: z
    .enum(["get", "replace", "insert", "delete"])
    .describe(
      "get = return matched section(s); replace/delete need a match; insert places `section` at `position`.",
    ),
  section_id: z
    .string()
    .optional()
    .describe(
      "Match a top-level section by its Elementor element id (the `id` field).",
    ),
  match_class: z
    .string()
    .optional()
    .describe(
      "Match top-level section(s) whose `_css_classes` contains this token. Use this OR section_id.",
    ),
  section: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "The section object (elType:'section') to write — required for replace/insert.",
    ),
  position: z
    .enum(["before", "after", "start", "end"])
    .default("end")
    .describe(
      "insert: before/after the matched section, or start/end of the page.",
    ),
  confirm: z
    .boolean()
    .default(false)
    .describe("Required on a production target for mutating actions."),
});
export type WpElementorSectionInput = z.infer<
  typeof WpElementorSectionInputSchema
>;

export const WpElementorSectionOutputSchema = z.object({
  post_id: z.number().int(),
  action: z.string(),
  matched: z.number().int().nonnegative(),
  matched_ids: z.array(z.string()),
  total_sections: z.number().int().nonnegative(),
  bytes_written: z.number().int().nonnegative().optional(),
  backup_path: z.string().nullable().optional(),
  flushed: z.boolean().optional(),
  sections: z
    .array(z.unknown())
    .optional()
    .describe("get: the matched section objects."),
});
export type WpElementorSectionOutput = z.infer<
  typeof WpElementorSectionOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_elementor_restore — list / restore _elementor_data backups
// ---------------------------------------------------------------------------

export const WpElementorRestoreInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  action: z.enum(["list", "restore"]).default("list"),
  backup_path: z
    .string()
    .optional()
    .describe(
      "Path (from action:list) of the backup to restore — required for restore.",
    ),
  confirm: z
    .boolean()
    .default(false)
    .describe("Required on a production target for restore."),
});
export type WpElementorRestoreInput = z.infer<
  typeof WpElementorRestoreInputSchema
>;

export const WpElementorRestoreOutputSchema = z.object({
  post_id: z.number().int(),
  action: z.string(),
  backups: z
    .array(
      z.object({
        path: z.string(),
        bytes: z.number().int().nonnegative(),
        mtime: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  restored_from: z.string().optional(),
  bytes_written: z.number().int().nonnegative().optional(),
  pre_restore_backup: z.string().nullable().optional(),
  flushed: z.boolean().optional(),
});
export type WpElementorRestoreOutput = z.infer<
  typeof WpElementorRestoreOutputSchema
>;

// ---------------------------------------------------------------------------
// rolepod_wp_render_get — fetch rendered front-end HTML of a post
// ---------------------------------------------------------------------------

export const WpRenderGetInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Post/page id — its permalink is fetched."),
  url: z
    .string()
    .url()
    .optional()
    .describe("Explicit URL on the target host (overrides post_id)."),
  grep: z
    .string()
    .optional()
    .describe("Regex — return only matching lines (+/- context)."),
  context: z.number().int().nonnegative().default(0),
  ignore_case: z.boolean().default(false),
  max_bytes: z
    .number()
    .int()
    .positive()
    .default(60000)
    .describe(
      "Cap returned bytes. Rendered HTML is large — default keeps the response bounded.",
    ),
});
export type WpRenderGetInput = z.infer<typeof WpRenderGetInputSchema>;

export const WpRenderGetOutputSchema = z.object({
  url: z.string(),
  status: z.number().int(),
  total_bytes: z.number().int().nonnegative(),
  returned_bytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
  matched_lines: z.number().int().nonnegative().optional(),
  content: z.string(),
});
export type WpRenderGetOutput = z.infer<typeof WpRenderGetOutputSchema>;
