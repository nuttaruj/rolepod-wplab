import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { makeRunId } from '../../artifact/runId.js'
import {
  AuditSecurityInputSchema,
  AuditSecurityOutputSchema,
  type AuditSecurityInput,
  type AuditSecurityOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'

export const wpAuditSecurityToolDef = {
  name: 'rolepod_wp_audit_security',
  description:
    'Audit a WP target — checks for outdated core/plugins/themes, weak admin users (login = "admin"), and WP_DEBUG flag. v0.2 covers the basic surface; v0.3 adds CVE lookup against patchstack/wpvulndb mirror + file-permission audit. Returns structured report + writes markdown/json artifact to ./.rolepod-wplab/artifacts/<run_id>/audit-report.md|.json.',
  inputSchema: AuditSecurityInputSchema,
}

export async function wpAuditSecurityHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<AuditSecurityOutput> {
  const input: AuditSecurityInput = AuditSecurityInputSchema.parse(raw)
  const target = registry.get(input.target_id)
  const runId = makeRunId()

  // 1. Core version + update available?
  const coreCheck = await target.wpCli(['core', 'check-update', '--format=json'])
  const coreOutdated = coreCheck.exitCode === 0 && coreCheck.stdout.trim() !== '' && coreCheck.stdout.trim() !== '[]'

  // 2. Plugin status
  const pluginList = await target.wpCli(['plugin', 'list', '--format=json'])
  const outdatedPlugins: Array<{ slug: string; current: string; latest: string }> = []
  if (pluginList.exitCode === 0) {
    try {
      const plugins = JSON.parse(pluginList.stdout || '[]') as Array<{
        name: string
        version: string
        update: string
        update_version?: string
      }>
      for (const p of plugins) {
        if (p.update === 'available') {
          outdatedPlugins.push({
            slug: p.name,
            current: p.version,
            latest: p.update_version ?? '(unknown)',
          })
        }
      }
    } catch {
      // ignore parse error
    }
  }

  // 3. Theme status
  const themeList = await target.wpCli(['theme', 'list', '--format=json'])
  const outdatedThemes: Array<{ slug: string; current: string; latest: string }> = []
  if (themeList.exitCode === 0) {
    try {
      const themes = JSON.parse(themeList.stdout || '[]') as Array<{
        name: string
        version: string
        update: string
        update_version?: string
      }>
      for (const t of themes) {
        if (t.update === 'available') {
          outdatedThemes.push({
            slug: t.name,
            current: t.version,
            latest: t.update_version ?? '(unknown)',
          })
        }
      }
    } catch {
      // ignore
    }
  }

  // 4. Weak admin users — flag any login = "admin"
  const userList = await target.wpCli(['user', 'list', '--role=administrator', '--format=json'])
  const weakAdmins: Array<{ login: string; reason: string }> = []
  if (userList.exitCode === 0) {
    try {
      const users = JSON.parse(userList.stdout || '[]') as Array<{ user_login: string }>
      for (const u of users) {
        const login = u.user_login.toLowerCase()
        if (login === 'admin') {
          weakAdmins.push({ login: u.user_login, reason: 'default/easy-to-guess login name "admin"' })
        }
      }
    } catch {
      // ignore
    }
  }

  // 5. WP_DEBUG flag
  const wpDebug = await target.wpCli(['config', 'get', 'WP_DEBUG'])
  const wpDebugOn = wpDebug.exitCode === 0 && /^(1|true)\s*$/i.test(wpDebug.stdout)

  // 6. Write report artifact
  const artifactDir = join(process.cwd(), '.rolepod-wplab', 'artifacts', runId)
  await mkdir(artifactDir, { recursive: true })

  const reportPath =
    input.report_format === 'json'
      ? join(artifactDir, 'audit-report.json')
      : join(artifactDir, 'audit-report.md')

  const json = {
    run_id: runId,
    target: target.siteurl,
    wp_core_outdated: coreOutdated,
    outdated_plugins: outdatedPlugins,
    outdated_themes: outdatedThemes,
    weak_admin_users: weakAdmins,
    wp_debug_on: wpDebugOn,
  }

  if (input.report_format === 'json') {
    await writeFile(reportPath, JSON.stringify(json, null, 2), 'utf8')
  } else {
    const md = renderMarkdown(json)
    await writeFile(reportPath, md, 'utf8')
  }

  return AuditSecurityOutputSchema.parse({
    run_id: runId,
    wp_core_outdated: coreOutdated,
    outdated_plugins: outdatedPlugins,
    outdated_themes: outdatedThemes,
    weak_admin_users: weakAdmins,
    wp_debug_on: wpDebugOn,
    report_path: reportPath,
  })
}

function renderMarkdown(j: {
  run_id: string
  target: string
  wp_core_outdated: boolean
  outdated_plugins: Array<{ slug: string; current: string; latest: string }>
  outdated_themes: Array<{ slug: string; current: string; latest: string }>
  weak_admin_users: Array<{ login: string; reason: string }>
  wp_debug_on: boolean
}): string {
  const lines: string[] = []
  lines.push(`# WP Security Audit — ${j.run_id}`)
  lines.push(`Target: ${j.target}`)
  lines.push(`Generated: ${new Date().toISOString()}\n`)
  lines.push(`## Core`)
  lines.push(`- Update available: ${j.wp_core_outdated ? 'YES' : 'no'}\n`)
  lines.push(`## Outdated plugins (${j.outdated_plugins.length})`)
  for (const p of j.outdated_plugins) lines.push(`- ${p.slug}: ${p.current} → ${p.latest}`)
  lines.push('')
  lines.push(`## Outdated themes (${j.outdated_themes.length})`)
  for (const t of j.outdated_themes) lines.push(`- ${t.slug}: ${t.current} → ${t.latest}`)
  lines.push('')
  lines.push(`## Weak admin users (${j.weak_admin_users.length})`)
  for (const u of j.weak_admin_users) lines.push(`- ${u.login}: ${u.reason}`)
  lines.push('')
  lines.push(`## WP_DEBUG`)
  lines.push(`- Enabled: ${j.wp_debug_on ? 'YES (smell on prod)' : 'no'}`)
  return lines.join('\n') + '\n'
}

// silence unused-import warning when mkdir + dirname are only conditionally used
void dirname
