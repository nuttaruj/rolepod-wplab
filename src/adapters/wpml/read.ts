import type { Target } from '../../runtime/Target.js'
import type { Adapter } from '../_contract.ts'

export interface WpmlReadAPI {
  /** List configured languages (active site languages). */
  languages(target: Target): Promise<Array<{ code: string; native_name: string; default: boolean }>>
  /** List string translations grouped by domain. */
  stringTranslations(target: Target, opts?: { domain?: string }): Promise<unknown[]>
  /** Translation status of a single post. */
  postTranslations(target: Target, postId: number): Promise<unknown>
}

const SLUG = 'wpml'

export const wpmlAdapter: Adapter<WpmlReadAPI> = {
  slug: SLUG,
  name: 'WPML (Multilingual)',
  supportedRange: { min: '4.5', testedUpTo: '4.7' },

  async detect(target: Target): Promise<boolean> {
    try {
      const res = await target.rest({ method: 'GET', path: '/' })
      const body = res.body as { routes?: Record<string, unknown> } | undefined
      if (body?.routes && typeof body.routes === 'object') {
        if (Object.keys(body.routes).some((r) => r.startsWith('/wpml/'))) return true
      }
    } catch {
      // fall through
    }
    if (target.kind === 'local' || target.kind === 'ssh' || target.kind === 'docker') {
      try {
        const r = await target.wpCli(['plugin', 'is-active', 'sitepress-multilingual-cms'])
        return r.exitCode === 0
      } catch {
        return false
      }
    }
    return false
  },

  read: {
    async languages(target) {
      // WPML REST: /wpml/v1/languages — pulls the configured language set.
      const res = await target.rest({ method: 'GET', path: '/wpml/v1/languages' })
      if (res.status >= 200 && res.status < 300 && Array.isArray(res.body)) {
        return (res.body as Array<{ code: string; native_name: string; default_locale?: boolean }>).map((l) => ({
          code: l.code,
          native_name: l.native_name,
          default: l.default_locale === true,
        }))
      }
      // wp-cli fallback via option
      if (target.kind === 'local' || target.kind === 'ssh' || target.kind === 'docker') {
        const r = await target.wpCli(['option', 'get', 'icl_sitepress_settings', '--format=json'])
        if (r.exitCode === 0) {
          try {
            const settings = JSON.parse(r.stdout || '{}') as { active_languages?: Record<string, unknown>; default_language?: string }
            const active = settings.active_languages ?? {}
            const def = settings.default_language ?? ''
            return Object.entries(active).map(([code, info]) => {
              const i = info as { native_name?: string }
              return { code, native_name: i.native_name ?? code, default: code === def }
            })
          } catch {
            // ignore
          }
        }
      }
      return []
    },

    async stringTranslations(target, opts = {}) {
      const path = opts.domain
        ? `/wpml/v1/strings?domain=${encodeURIComponent(opts.domain)}`
        : '/wpml/v1/strings'
      const res = await target.rest({ method: 'GET', path })
      return Array.isArray(res.body) ? res.body : []
    },

    async postTranslations(target, postId) {
      const res = await target.rest({
        method: 'GET',
        path: `/wpml/v1/posts/${postId}/translations`,
      })
      return res.body ?? {}
    },
  },
}
