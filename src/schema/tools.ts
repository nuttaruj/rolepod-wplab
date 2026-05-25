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
