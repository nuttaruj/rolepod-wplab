import { wpCliAvailable } from '../runtime/wpCli.js'
import { loadProfile } from '../profile/load.js'

/**
 * `rolepod-wplab doctor` — interactive readiness check.
 *
 * Writes to stderr (so it doesn't pollute stdout if a downstream pipes the
 * output). Returns exit code: 0 = all clear, 1 = at least one required check
 * failed.
 */
export async function runDoctor(): Promise<number> {
  const lines: string[] = []
  let failed = false

  const profile = loadProfile()

  lines.push('[rolepod-wplab v0.0.0 — doctor]')
  lines.push(`  ✓ Node ${process.versions.node}`)

  const wp = await wpCliAvailable()
  if (wp.ok) {
    lines.push(`  ✓ wp-cli ${wp.version ?? '(version unknown)'}`)
  } else {
    failed = true
    lines.push('  ✗ wp-cli NOT FOUND')
    lines.push('    Install:')
    lines.push('      curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar')
    lines.push('      chmod +x wp-cli.phar && sudo mv wp-cli.phar /usr/local/bin/wp')
    lines.push('    Or via homebrew:  brew install wp-cli')
  }

  lines.push(`  ✓ Profile: ${profile.profile}`)
  if (profile.production_hosts.length > 0) {
    lines.push(`  ✓ Production hosts: ${profile.production_hosts.join(', ')}`)
  } else {
    lines.push('  ! No production_hosts configured — set ROLEPOD_WPLAB_PROD_HOSTS or profile.json')
  }

  if (profile.profile === 'power') {
    lines.push('  ! Power profile selected — companion tools land in v0.2 (not yet registered in v0.0)')
  }

  for (const line of lines) process.stderr.write(`${line}\n`)
  return failed ? 1 : 0
}
