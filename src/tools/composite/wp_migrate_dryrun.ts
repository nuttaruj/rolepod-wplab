import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { makeRunId } from '../../artifact/runId.js'
import {
  MigrateDryrunInputSchema,
  MigrateDryrunOutputSchema,
  type MigrateDryrunInput,
  type MigrateDryrunOutput,
} from '../../schema/tools.js'
import type { TargetRegistry } from '../../target/TargetRegistry.js'
import type { Target } from '../../runtime/Target.js'

export const wpMigrateDryrunToolDef = {
  name: 'rolepod_wp_migrate_dryrun',
  description:
    'Compute a migration plan between two targets without applying any changes. Currently supports scope: plugin_versions (diff installed plugins + versions), options (autoloaded options diff), users (admin role diff), posts (post count diff per type). Writes plan to ./.rolepod-wplab/artifacts/<run_id>/migration-plan.json.',
  inputSchema: MigrateDryrunInputSchema,
}

export async function wpMigrateDryrunHandler(
  registry: TargetRegistry,
  raw: unknown,
): Promise<MigrateDryrunOutput> {
  const input: MigrateDryrunInput = MigrateDryrunInputSchema.parse(raw)
  const source = registry.get(input.source_target_id)
  const dest = registry.get(input.dest_target_id)
  const runId = makeRunId()

  const plan: Record<string, unknown> = {
    source: source.siteurl,
    dest: dest.siteurl,
    scope: input.scope,
    generated: new Date().toISOString(),
    diffs: {},
  }
  const diffs = plan['diffs'] as Record<string, unknown>

  if (input.scope.includes('plugin_versions')) {
    diffs['plugin_versions'] = await diffPlugins(source, dest)
  }
  if (input.scope.includes('options')) {
    diffs['options'] = await diffOptions(source, dest)
  }
  if (input.scope.includes('users')) {
    diffs['users'] = await diffUsers(source, dest)
  }
  if (input.scope.includes('posts')) {
    diffs['posts'] = await diffPostCounts(source, dest)
  }

  const artifactDir = join(process.cwd(), '.rolepod-wplab', 'artifacts', runId)
  await mkdir(artifactDir, { recursive: true })
  const planPath = join(artifactDir, 'migration-plan.json')
  await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8')

  return MigrateDryrunOutputSchema.parse({ run_id: runId, plan, plan_path: planPath })
}

async function diffPlugins(source: Target, dest: Target): Promise<unknown> {
  const [s, d] = await Promise.all([
    pluginsOf(source),
    pluginsOf(dest),
  ])
  const onlyInSource: typeof s = []
  const onlyInDest: typeof d = []
  const versionMismatch: Array<{ slug: string; source: string; dest: string }> = []
  const srcMap = new Map(s.map((p) => [p.name, p]))
  const dstMap = new Map(d.map((p) => [p.name, p]))
  for (const p of s) {
    const o = dstMap.get(p.name)
    if (!o) onlyInSource.push(p)
    else if (o.version !== p.version) {
      versionMismatch.push({ slug: p.name, source: p.version, dest: o.version })
    }
  }
  for (const p of d) {
    if (!srcMap.has(p.name)) onlyInDest.push(p)
  }
  return { only_in_source: onlyInSource, only_in_dest: onlyInDest, version_mismatch: versionMismatch }
}

async function pluginsOf(target: Target): Promise<Array<{ name: string; version: string; status: string }>> {
  const r = await target.wpCli(['plugin', 'list', '--format=json'])
  if (r.exitCode !== 0) return []
  try {
    return JSON.parse(r.stdout || '[]') as Array<{ name: string; version: string; status: string }>
  } catch {
    return []
  }
}

async function diffOptions(source: Target, dest: Target): Promise<unknown> {
  const [s, d] = await Promise.all([
    rowsOf(source, ['option', 'list', '--autoload=on', '--format=json', '--fields=option_name']),
    rowsOf(dest, ['option', 'list', '--autoload=on', '--format=json', '--fields=option_name']),
  ])
  const srcSet = new Set(s.map((r) => r.option_name as string))
  const dstSet = new Set(d.map((r) => r.option_name as string))
  const onlyInSource = [...srcSet].filter((k) => !dstSet.has(k))
  const onlyInDest = [...dstSet].filter((k) => !srcSet.has(k))
  return { only_in_source: onlyInSource, only_in_dest: onlyInDest }
}

async function diffUsers(source: Target, dest: Target): Promise<unknown> {
  const [s, d] = await Promise.all([
    rowsOf(source, ['user', 'list', '--role=administrator', '--format=json', '--fields=user_login,user_email']),
    rowsOf(dest, ['user', 'list', '--role=administrator', '--format=json', '--fields=user_login,user_email']),
  ])
  const srcSet = new Set(s.map((r) => r.user_login as string))
  const dstSet = new Set(d.map((r) => r.user_login as string))
  return {
    only_in_source: [...srcSet].filter((k) => !dstSet.has(k)),
    only_in_dest: [...dstSet].filter((k) => !srcSet.has(k)),
  }
}

async function diffPostCounts(source: Target, dest: Target): Promise<unknown> {
  const countsOf = async (t: Target) => {
    const r = await t.wpCli(['post', 'list', '--post_type=any', '--format=count'])
    return r.exitCode === 0 ? Number.parseInt(r.stdout.trim(), 10) : 0
  }
  const [s, d] = await Promise.all([countsOf(source), countsOf(dest)])
  return { source_post_count: s, dest_post_count: d, delta: s - d }
}

async function rowsOf(target: Target, args: string[]): Promise<Array<Record<string, unknown>>> {
  const r = await target.wpCli(args)
  if (r.exitCode !== 0) return []
  try {
    return JSON.parse(r.stdout || '[]') as Array<Record<string, unknown>>
  } catch {
    return []
  }
}
