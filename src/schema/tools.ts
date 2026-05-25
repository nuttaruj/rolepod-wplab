import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const TargetIdSchema = z.string().regex(/^tgt_[a-z0-9]{8,}$/, {
  message: 'target_id must look like tgt_<8+ lowercase hex>',
})

export const RunIdSchema = z.string().regex(/^wplab_\d{8}T\d{6}_[a-z0-9]{8}$/)

// ---------------------------------------------------------------------------
// rolepod_wp_connect_local
// ---------------------------------------------------------------------------

export const ConnectLocalInputSchema = z.object({
  path: z.string().min(1, 'WP install path required'),
})
export type ConnectLocalInput = z.infer<typeof ConnectLocalInputSchema>

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
})
export type ConnectLocalOutput = z.infer<typeof ConnectLocalOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_connect_rest (W-027)
// ---------------------------------------------------------------------------

export const ConnectRestInputSchema = z.object({
  url: z.string().url().refine((u) => u.startsWith('https://'), {
    message: 'URL must use https:// (refuses plaintext App Password transport)',
  }),
  credential_ref: z.string().optional().describe(
    'Override default keychain lookup. If omitted, runtime resolves credentials by canonical hostname of url.',
  ),
  require_companion: z.boolean().default(false).describe(
    'Abort connect if companion handshake fails. Default: allow target open without companion (RestTarget still works for built-in REST routes).',
  ),
})
export type ConnectRestInput = z.infer<typeof ConnectRestInputSchema>

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
  memory_summary: z.string().optional().describe(
    'Populated when per-site memory directory exists (W-028, v0.2+). Brief recap of stored notes.',
  ),
})
export type ConnectRestOutput = z.infer<typeof ConnectRestOutputSchema>

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
})
export type ConnectSshInput = z.infer<typeof ConnectSshInputSchema>

export const ConnectSshOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string(),
  wp_version: z.string(),
})
export type ConnectSshOutput = z.infer<typeof ConnectSshOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_connect_docker (v0.3)
// ---------------------------------------------------------------------------

export const ConnectDockerInputSchema = z.object({
  container_name: z.string().min(1),
  wp_path: z.string().default('/var/www/html'),
  docker_host: z.string().optional(),
  docker_socket_path: z.string().optional(),
})
export type ConnectDockerInput = z.infer<typeof ConnectDockerInputSchema>

export const ConnectDockerOutputSchema = z.object({
  target_id: TargetIdSchema,
  siteurl: z.string(),
  wp_version: z.string(),
})
export type ConnectDockerOutput = z.infer<typeof ConnectDockerOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_disconnect
// ---------------------------------------------------------------------------

export const DisconnectInputSchema = z.object({
  target_id: TargetIdSchema,
})
export type DisconnectInput = z.infer<typeof DisconnectInputSchema>

export const DisconnectOutputSchema = z.object({
  closed: z.literal(true),
})
export type DisconnectOutput = z.infer<typeof DisconnectOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_cli_run
// ---------------------------------------------------------------------------

export const WpCliRunInputSchema = z.object({
  target_id: TargetIdSchema,
  args: z.array(z.string()).min(1, 'wp-cli args required (e.g. ["plugin","list"])'),
  allow_destructive: z.boolean().default(false),
  timeout_ms: z.number().int().positive().max(120_000).default(30_000),
})
export type WpCliRunInput = z.infer<typeof WpCliRunInputSchema>

export const WpCliRunOutputSchema = z.object({
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  duration_ms: z.number(),
})
export type WpCliRunOutput = z.infer<typeof WpCliRunOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_health_check
// ---------------------------------------------------------------------------

export const WpHealthCheckInputSchema = z.object({
  target_id: TargetIdSchema,
})
export type WpHealthCheckInput = z.infer<typeof WpHealthCheckInputSchema>

export const WpHealthCheckOutputSchema = z.object({
  wp_version: z.string(),
  php_version: z.string().optional(),
  db_ok: z.boolean(),
  wp_cli_ok: z.boolean(),
  rest_ok: z.boolean(),
  companion_ok: z.boolean(),
  site_url: z.string().url(),
  warnings: z.array(z.string()),
})
export type WpHealthCheckOutput = z.infer<typeof WpHealthCheckOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_post_get / list / create / update
// ---------------------------------------------------------------------------

export const PostGetInputSchema = z.object({
  target_id: TargetIdSchema,
  id: z.number().int().positive(),
  context: z.enum(['view', 'edit', 'embed']).default('view'),
  type: z.string().default('posts').describe('REST collection slug (posts, pages, etc.)'),
})
export type PostGetInput = z.infer<typeof PostGetInputSchema>

export const PostGetOutputSchema = z.object({
  status: z.number().int(),
  post: z.unknown(),
})
export type PostGetOutput = z.infer<typeof PostGetOutputSchema>

export const PostListInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default('posts'),
  per_page: z.number().int().min(1).max(100).default(20),
  page: z.number().int().positive().default(1),
  search: z.string().optional(),
  status: z.string().optional(),
  orderby: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
})
export type PostListInput = z.infer<typeof PostListInputSchema>

export const PostListOutputSchema = z.object({
  status: z.number().int(),
  items: z.array(z.unknown()),
  total: z.number().int().nonnegative().optional(),
  total_pages: z.number().int().nonnegative().optional(),
})
export type PostListOutput = z.infer<typeof PostListOutputSchema>

export const PostCreateInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default('posts'),
  title: z.string(),
  content: z.string(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).default('draft'),
  excerpt: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type PostCreateInput = z.infer<typeof PostCreateInputSchema>

export const PostCreateOutputSchema = z.object({
  status: z.number().int(),
  id: z.number().int().positive(),
  link: z.string().url().optional(),
})
export type PostCreateOutput = z.infer<typeof PostCreateOutputSchema>

export const PostUpdateInputSchema = z.object({
  target_id: TargetIdSchema,
  type: z.string().default('posts'),
  id: z.number().int().positive(),
  title: z.string().optional(),
  content: z.string().optional(),
  status: z.enum(['publish', 'future', 'draft', 'pending', 'private']).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type PostUpdateInput = z.infer<typeof PostUpdateInputSchema>

export const PostUpdateOutputSchema = z.object({
  status: z.number().int(),
  id: z.number().int().positive(),
  modified: z.string().optional(),
})
export type PostUpdateOutput = z.infer<typeof PostUpdateOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_option_get / set
// ---------------------------------------------------------------------------

export const OptionGetInputSchema = z.object({
  target_id: TargetIdSchema,
  name: z.string().min(1),
})
export type OptionGetInput = z.infer<typeof OptionGetInputSchema>

export const OptionGetOutputSchema = z.object({
  name: z.string(),
  value: z.unknown(),
  source: z.enum(['wp_cli', 'rest_settings']).describe('which transport actually returned the value'),
})
export type OptionGetOutput = z.infer<typeof OptionGetOutputSchema>

export const OptionSetInputSchema = z.object({
  target_id: TargetIdSchema,
  name: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean(), z.record(z.string(), z.unknown()), z.array(z.unknown())]),
  confirm: z.boolean().default(false).describe('Required true on production-matched targets'),
})
export type OptionSetInput = z.infer<typeof OptionSetInputSchema>

export const OptionSetOutputSchema = z.object({
  name: z.string(),
  changed: z.boolean(),
  source: z.enum(['wp_cli', 'rest_settings']),
})
export type OptionSetOutput = z.infer<typeof OptionSetOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_user_list
// ---------------------------------------------------------------------------

export const UserListInputSchema = z.object({
  target_id: TargetIdSchema,
  per_page: z.number().int().min(1).max(100).default(20),
  page: z.number().int().positive().default(1),
  search: z.string().optional(),
  role: z.string().optional(),
})
export type UserListInput = z.infer<typeof UserListInputSchema>

export const UserListOutputSchema = z.object({
  status: z.number().int(),
  users: z.array(z.unknown()),
})
export type UserListOutput = z.infer<typeof UserListOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_db_query
// ---------------------------------------------------------------------------

export const DbQueryInputSchema = z.object({
  target_id: TargetIdSchema,
  sql: z.string().min(1),
  allow_write: z.boolean().default(false).describe(
    'Override SELECT-only guard. Production guard still applies on top.',
  ),
  confirm: z.boolean().default(false).describe(
    'Required true on production-matched targets when allow_write=true',
  ),
})
export type DbQueryInput = z.infer<typeof DbQueryInputSchema>

export const DbQueryOutputSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).optional(),
  stdout: z.string(),
  stderr: z.string(),
  exit_code: z.number().int(),
})
export type DbQueryOutput = z.infer<typeof DbQueryOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_rest_request — generic REST passthrough
// ---------------------------------------------------------------------------

export const RestRequestInputSchema = z.object({
  target_id: TargetIdSchema,
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  path: z.string().min(1).describe('REST route, e.g. "/wp/v2/posts" — leading slash optional'),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})
export type RestRequestInput = z.infer<typeof RestRequestInputSchema>

export const RestRequestOutputSchema = z.object({
  status: z.number().int(),
  body: z.unknown(),
  headers: z.record(z.string(), z.string()),
})
export type RestRequestOutput = z.infer<typeof RestRequestOutputSchema>

// ---------------------------------------------------------------------------
// Composites — v0.2 (phase-aware orchestrations)
// ---------------------------------------------------------------------------

const RunIdShape = z.string().regex(/^wplab_\d{8}T\d{6}_[a-z0-9]{8}$/)

export const ScaffoldBlockInputSchema = z.object({
  target_id: TargetIdSchema,
  plugin_slug: z.string().min(1),
  block_slug: z.string().regex(/^[a-z0-9_-]+\/[a-z0-9_-]+$/, {
    message: 'block_slug must be namespaced like "my-team/testimonial-card"',
  }),
  title: z.string().min(1),
  description: z.string().optional(),
  category: z.string().default('design'),
  icon: z.string().default('star-filled'),
  render_strategy: z.enum(['dynamic', 'static']).default('dynamic'),
  allow_destructive: z.literal(true),
})
export type ScaffoldBlockInput = z.infer<typeof ScaffoldBlockInputSchema>

export const ScaffoldBlockOutputSchema = z.object({
  run_id: RunIdShape,
  files_written: z.array(z.string()),
  next_steps: z.array(z.string()),
})
export type ScaffoldBlockOutput = z.infer<typeof ScaffoldBlockOutputSchema>

export const ScaffoldPluginInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().default('AI-generated'),
  features: z
    .array(z.enum(['rest_endpoint', 'admin_page', 'gutenberg_block', 'cli_command']))
    .default([]),
  allow_destructive: z.literal(true),
})
export type ScaffoldPluginInput = z.infer<typeof ScaffoldPluginInputSchema>

export const ScaffoldPluginOutputSchema = z.object({
  run_id: RunIdShape,
  plugin_path: z.string(),
  files_written: z.array(z.string()),
  activate_command: z.string(),
})
export type ScaffoldPluginOutput = z.infer<typeof ScaffoldPluginOutputSchema>

export const ScaffoldThemeInputSchema = z.object({
  target_id: TargetIdSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  author: z.string().default('AI-generated'),
  allow_destructive: z.literal(true),
})
export type ScaffoldThemeInput = z.infer<typeof ScaffoldThemeInputSchema>

export const ScaffoldThemeOutputSchema = z.object({
  run_id: RunIdShape,
  theme_path: z.string(),
  files_written: z.array(z.string()),
  activate_command: z.string(),
})
export type ScaffoldThemeOutput = z.infer<typeof ScaffoldThemeOutputSchema>

export const AuditSecurityInputSchema = z.object({
  target_id: TargetIdSchema,
  report_format: z.enum(['markdown', 'json']).default('markdown'),
})
export type AuditSecurityInput = z.infer<typeof AuditSecurityInputSchema>

export const AuditSecurityOutputSchema = z.object({
  run_id: RunIdShape,
  wp_core_outdated: z.boolean(),
  outdated_plugins: z.array(z.object({ slug: z.string(), current: z.string(), latest: z.string() })),
  outdated_themes: z.array(z.object({ slug: z.string(), current: z.string(), latest: z.string() })),
  weak_admin_users: z.array(z.object({ login: z.string(), reason: z.string() })),
  wp_debug_on: z.boolean(),
  report_path: z.string(),
})
export type AuditSecurityOutput = z.infer<typeof AuditSecurityOutputSchema>

export const MigrateDryrunInputSchema = z.object({
  source_target_id: TargetIdSchema,
  dest_target_id: TargetIdSchema,
  scope: z.array(z.enum(['posts', 'options', 'users', 'plugin_versions'])).default(['plugin_versions']),
})
export type MigrateDryrunInput = z.infer<typeof MigrateDryrunInputSchema>

export const MigrateDryrunOutputSchema = z.object({
  run_id: RunIdShape,
  plan: z.record(z.string(), z.unknown()),
  plan_path: z.string(),
})
export type MigrateDryrunOutput = z.infer<typeof MigrateDryrunOutputSchema>

// ---------------------------------------------------------------------------
// Companion-gated power tools — v0.2 (W-003R, W-004R)
// ---------------------------------------------------------------------------

export const ExecutePhpInputSchema = z.object({
  target_id: TargetIdSchema,
  payload: z.string().min(1),
  timeout_ms: z.number().int().min(100).max(30_000).default(5000),
  confirm: z.literal(true),
})
export type ExecutePhpInput = z.infer<typeof ExecutePhpInputSchema>

export const ExecutePhpOutputSchema = z.object({
  ok: z.boolean(),
  return_value: z.unknown().optional(),
  stdout: z.string().optional(),
  duration_ms: z.number().optional(),
  php_warnings: z.array(z.string()).optional(),
  audit_id: z.string(),
  error_message: z.string().optional(),
})
export type ExecutePhpOutput = z.infer<typeof ExecutePhpOutputSchema>

export const IntrospectInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(['hooks', 'transients', 'options_full', 'request_state']),
  include_values: z.boolean().default(false),
})
export type IntrospectInput = z.infer<typeof IntrospectInputSchema>

export const IntrospectOutputSchema = z.object({
  scope: z.string(),
  report: z.unknown(),
})
export type IntrospectOutput = z.infer<typeof IntrospectOutputSchema>

export const HookStateInputSchema = z.object({
  target_id: TargetIdSchema,
  hook: z.string().min(1),
  kind: z.enum(['action', 'filter']).default('action'),
})
export type HookStateInput = z.infer<typeof HookStateInputSchema>

export const HookStateOutputSchema = z.object({
  hook: z.string(),
  kind: z.enum(['action', 'filter']),
  callbacks: z.array(
    z.object({
      priority: z.number().int(),
      callback_identifier: z.string(),
    }),
  ),
})
export type HookStateOutput = z.infer<typeof HookStateOutputSchema>

// ---------------------------------------------------------------------------
// Memory tools — W-028, v0.2
// ---------------------------------------------------------------------------

export const MemoryRecallInputSchema = z.object({
  target_id: TargetIdSchema,
  query: z.string().optional(),
  kind: z.enum(['note', 'convention', 'runbook', 'all']).default('all'),
})
export type MemoryRecallInput = z.infer<typeof MemoryRecallInputSchema>

export const MemoryRecallOutputSchema = z.object({
  site_slug: z.string(),
  summary: z.string(),
  notes: z.array(
    z.object({
      kind: z.enum(['note', 'convention', 'runbook']),
      name: z.string(),
      content: z.string(),
      written_at: z.string(),
    }),
  ),
})
export type MemoryRecallOutput = z.infer<typeof MemoryRecallOutputSchema>

export const MemoryNoteInputSchema = z.object({
  target_id: TargetIdSchema,
  content: z.string().min(1),
  kind: z.enum(['note', 'convention', 'runbook']).default('note'),
  runbook_name: z.string().optional(),
  tags: z.array(z.string()).optional(),
})
export type MemoryNoteInput = z.infer<typeof MemoryNoteInputSchema>

export const MemoryNoteOutputSchema = z.object({
  saved_at: z.string(),
  file_path: z.string(),
  site_slug: z.string(),
})
export type MemoryNoteOutput = z.infer<typeof MemoryNoteOutputSchema>

export const MemoryListInputSchema = z.object({
  target_id: TargetIdSchema,
})
export type MemoryListInput = z.infer<typeof MemoryListInputSchema>

export const MemoryListOutputSchema = z.object({
  site_slug: z.string(),
  files: z.array(
    z.object({
      kind: z.enum(['meta', 'site', 'note', 'convention', 'runbook']),
      name: z.string(),
      size_bytes: z.number().int().nonnegative(),
      mtime: z.string(),
    }),
  ),
  total_bytes: z.number().int().nonnegative(),
})
export type MemoryListOutput = z.infer<typeof MemoryListOutputSchema>

// ---------------------------------------------------------------------------
// Adapters — Elementor / WooCommerce / ACF (read-only, v0.1, W-023)
// ---------------------------------------------------------------------------

export const ElementorReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z.number().int().positive().optional().describe('Single page to dump; omit to list.'),
  type: z.string().default('page').describe('Post type to query when listing.'),
  per_page: z.number().int().min(1).max(100).default(50),
})
export type ElementorReadInput = z.infer<typeof ElementorReadInputSchema>

export const ElementorReadOutputSchema = z.object({
  mode: z.enum(['list', 'page']),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
})
export type ElementorReadOutput = z.infer<typeof ElementorReadOutputSchema>

export const WooReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum([
    'products',
    'orders',
    'settings_groups',
    'settings_in_group',
    'shipping_zones',
    'payment_gateways',
  ]),
  group: z.string().optional().describe('Required when scope=settings_in_group'),
  per_page: z.number().int().min(1).max(100).optional(),
  search: z.string().optional(),
  status: z.string().optional(),
})
export type WooReadInput = z.infer<typeof WooReadInputSchema>

export const WooReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  items: z.array(z.unknown()),
})
export type WooReadOutput = z.infer<typeof WooReadOutputSchema>

export const AcfReadInputSchema = z.object({
  target_id: TargetIdSchema,
  scope: z.enum(['field_groups', 'fields_in_group', 'post_meta']),
  group_key: z.string().optional().describe('Required when scope=fields_in_group'),
  post_id: z.number().int().positive().optional().describe('Required when scope=post_meta'),
})
export type AcfReadInput = z.infer<typeof AcfReadInputSchema>

export const AcfReadOutputSchema = z.object({
  scope: z.string(),
  detected: z.boolean(),
  items: z.array(z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type AcfReadOutput = z.infer<typeof AcfReadOutputSchema>

// --- Adapter writes (v0.2) ---

export const ElementorWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  widget_tree: z.array(z.unknown()),
  allow_destructive: z.literal(true),
  confirm: z.boolean().default(false),
})
export type ElementorWriteInput = z.infer<typeof ElementorWriteInputSchema>

export const ElementorWriteOutputSchema = z.object({
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
})
export type ElementorWriteOutput = z.infer<typeof ElementorWriteOutputSchema>

export const WooWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  op: z.enum(['update_product', 'bulk_update_prices']),
  product_id: z.number().int().positive().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  price_updates: z
    .array(
      z.object({
        id: z.number().int().positive(),
        regular_price: z.string().optional(),
        sale_price: z.string().optional(),
      }),
    )
    .optional(),
  allow_destructive: z.literal(true),
  confirm: z.boolean().default(false),
})
export type WooWriteInput = z.infer<typeof WooWriteInputSchema>

export const WooWriteOutputSchema = z.object({
  op: z.string(),
  result: z.unknown(),
})
export type WooWriteOutput = z.infer<typeof WooWriteOutputSchema>

export const AcfWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  post_id: z.number().int().positive(),
  field_name: z.string().min(1),
  value: z.unknown(),
  allow_destructive: z.literal(true),
  confirm: z.boolean().default(false),
})
export type AcfWriteInput = z.infer<typeof AcfWriteInputSchema>

export const AcfWriteOutputSchema = z.object({
  source: z.enum(['rest_acf_pro', 'wp_cli']),
  post_id: z.number().int().positive(),
  field_name: z.string(),
})
export type AcfWriteOutput = z.infer<typeof AcfWriteOutputSchema>

// --- Bricks read (v0.2) ---

export const BricksReadInputSchema = z.object({
  target_id: TargetIdSchema,
  page_id: z.number().int().positive().optional(),
  type: z.string().default('page'),
  per_page: z.number().int().min(1).max(100).default(50),
})
export type BricksReadInput = z.infer<typeof BricksReadInputSchema>

export const BricksReadOutputSchema = z.object({
  mode: z.enum(['list', 'page']),
  detected: z.boolean(),
  pages: z.array(z.unknown()).optional(),
  page: z.unknown().optional(),
})
export type BricksReadOutput = z.infer<typeof BricksReadOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_file_read
// ---------------------------------------------------------------------------

export const WpFileReadInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1).describe('Path relative to WP install root'),
})
export type WpFileReadInput = z.infer<typeof WpFileReadInputSchema>

export const WpFileReadOutputSchema = z.object({
  path: z.string(),
  content: z.string(),
  bytes: z.number().int().nonnegative(),
})
export type WpFileReadOutput = z.infer<typeof WpFileReadOutputSchema>

// ---------------------------------------------------------------------------
// rolepod_wp_file_write
// ---------------------------------------------------------------------------

export const WpFileWriteInputSchema = z.object({
  target_id: TargetIdSchema,
  path: z.string().min(1).describe('Path relative to WP install root'),
  content: z.string(),
  mode: z.enum(['overwrite', 'append']).default('overwrite'),
  backup: z.boolean().default(true),
  confirm_unsafe_path: z.boolean().default(false),
})
export type WpFileWriteInput = z.infer<typeof WpFileWriteInputSchema>

export const WpFileWriteOutputSchema = z.object({
  path: z.string(),
  bytes_written: z.number().int().nonnegative(),
  backup_path: z.string().nullable(),
})
export type WpFileWriteOutput = z.infer<typeof WpFileWriteOutputSchema>
