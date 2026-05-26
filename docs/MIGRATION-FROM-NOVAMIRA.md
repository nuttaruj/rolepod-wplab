# Migrating from a third-party plugin to rolepod-wplab

This guide is for users currently running [a third-party plugin](https://github.com/use-third-party/third-party) who want to evaluate or switch to `@rolepod/wplab`.

## Coexistence first

You can run both at the same time. There is **no architectural conflict**:

- a third-party plugin lives inside WordPress as a PHP plugin and exposes the AI client to `execute-php`, `db-query`, etc.
- wplab runs the MCP server on **your machine** and reaches into WordPress via wp-cli + REST + (optional) the `rolepod-wplab-companion` PHP plugin.
- Plugin slugs, REST namespaces (`wplab/v1/` vs a third-party plugin's), and option keys do not overlap.

Recommended migration flow:

1. **Phase 0 — install both.** Install wplab npm + companion (optional). Keep a third-party plugin active. Both work side by side.
2. **Phase 1 — use wplab on new tasks.** New scaffolds, audits, multi-site work → wplab. Existing a third-party plugin-driven workflows untouched.
3. **Phase 2 — re-test critical flows on wplab.** Run your typical operations end-to-end to confirm wplab covers them.
4. **Phase 3 — deactivate a third-party plugin.** Once confident, deactivate (don't delete yet) in WP admin. Run for a sprint.
5. **Phase 4 — delete a third-party plugin.** Confidence achieved → delete plugin via admin. Migration complete.

## Feature parity matrix

| a third-party plugin feature | wplab equivalent | Status (as of v1.1) |
|---|---|---|
| `execute-php` | `rolepod_wp_execute_php` (companion + power profile + non-prod) | ✅ ceiling matched |
| `db-query` arbitrary | `rolepod_wp_db_query` (SELECT-only default; `allow_write: true` + prod-guard) | ✅ safer-default |
| File ops | `rolepod_wp_file_{read,write}` (scoped to wp-content + wp-config) | ✅ scope-bounded |
| Plugin / theme list + install | `rolepod_wp_cli_run` (allow-listed) | ✅ same surface |
| Post / option / user CRUD | typed `wp_post_*`, `wp_option_*`, `wp_user_list` | ✅ typed |
| WP-CLI passthrough | `rolepod_wp_cli_run` allow-list + `allow_destructive` | ✅ guarded |
| Bulk product price update | `rolepod_wp_woo_write { op: bulk_update_prices }` | ✅ |
| Elementor edit | `rolepod_wp_elementor_{read,write}` | ✅ |
| Bricks edit | `rolepod_wp_bricks_{read,write}` (v1.1 write added) | ✅ |
| **Divi edit** | `rolepod_wp_divi_{read,write}` (v1.1) | ✅ |
| **Oxygen edit** | `rolepod_wp_oxygen_{read,write}` (v1.1) | ✅ |
| ACF field group operations | `rolepod_wp_acf_{read,write}` | ✅ |
| Yoast read + write | `rolepod_wp_yoast_{read,write}` (v1.1 write added) | ✅ |
| RankMath read + write | `rolepod_wp_rankmath_{read,write}` (v1.1 write added) | ✅ |
| WPML translations (read + write) | `rolepod_wp_wpml_{read,write}` (v1.1 write added) | ✅ |
| **Form plugins (Gravity / CF7 / WPForms)** | `rolepod_wp_forms_{read,write}` (v1.1) | ✅ wplab-unique |
| **WP-Cron inspect + control** | `rolepod_wp_cron_tool` (v1.1) | ✅ wplab-unique |
| **Cache + transient ops** | `rolepod_wp_cache_tool` (v1.1) | ✅ wplab-unique |
| **SMTP / wp_mail smoke** | `rolepod_wp_mail_test` (v1.1) | ✅ wplab-unique |
| **Full site clone dev→staging** | `rolepod_wp_clone` (v1.1) | ✅ wplab-unique |
| **Backup / restore** | `rolepod_wp_backup_{create,restore}` (v1.1) | ✅ wplab-unique |
| **Active user session enumeration** | `rolepod_wp_user_session_list` (v1.1) | ✅ wplab-unique |
| **REST surface discovery** | `rolepod_wp_rest_dump` (v1.1) | ✅ wplab-unique |
| **Block pattern scaffold** | `rolepod_wp_scaffold_pattern` (v1.1) | ✅ wplab-unique |
| **Diagnostic sweep (conflict / slow / errors)** | `rolepod_wp_diagnose` (v1.1) | ✅ wplab-unique |
| Per-site memory (a third-party plugin Pro) | `rolepod_wp_memory_{recall,note,list}` + `memory` CLI | ✅ local-only, $0 |
| Mid-request hook observation | `rolepod_wp_introspect { scope: hooks }` + companion `request-observer` | ✅ |
| Persistent PHP eval context | companion `php-session` endpoint | ✅ |
| Multi-site management | 1 MCP, N targets via `connect_local` / `connect_rest` / `connect_ssh` / `connect_docker` | ✅✅ |
| Cross-target diff / migrate | `wp_migrate_dryrun` + `wp_migrate_data` + `wp_audit_many` | ✅✅ |
| **Setup wizard (admin UI)** | Companion **Tools → WPLab Setup** page (v1.1) + `rolepod-wplab init` CLI | ✅ |

## Key behavioral differences

### 1. Default-safe vs default-on

a third-party plugin's `execute-php` is on by default once installed. wplab's `rolepod_wp_execute_php` requires THREE conditions to fire:

1. Companion installed on the target WP.
2. `ROLEPOD_WPLAB_PROFILE=power` on the Node MCP.
3. Target siteurl does NOT match `ROLEPOD_WPLAB_PROD_HOSTS`.

Any missing → tool refuses with a clear diagnostic. If you want a third-party plugin-equivalent always-on PHP eval, set profile=power and never set production hosts — but doing so deliberately accepts the risk.

### 2. Multi-target by default

If you manage 5 client sites with a third-party plugin, you install a third-party plugin on each. Updating means N upgrades.

With wplab: install the Node MCP once + register App Password credentials per site (`rolepod-wplab credentials add <hostname>`). One MCP serves all. Installing the companion is still per-site (only if you need execute-php / introspect on that site).

### 3. UX trade-off

a third-party plugin's WP-admin GUI + copy-prompt is ~2-min setup, friendlier for non-CLI users. wplab requires `npm install` + `claude mcp add` — fine for AI-CLI-comfortable devs, more friction for designer/marketer types.

If you primarily click in WP admin, a third-party plugin's UX is better. If you primarily live in Claude Code / Cursor / Codex CLI, wplab fits more naturally.

### 4. License + commercial use

| | a third-party plugin | wplab |
|---|---|---|
| Core | AGPL-3.0 | MIT |
| Pro features (memory) | €49/yr | $0 (built-in v0.2+) |
| Commercial product use | requires AGPL compliance downstream | unrestricted |

If you ship a commercial WP plugin or service that integrates this functionality, MIT is friendlier.

## Migrating memory / context

a third-party plugin Pro memory lives in their service (assume — Pro tier specifics not public). wplab memory is local files at `~/.config/rolepod-wplab/memory/<site>/`.

To carry forward site context manually:

1. Export a third-party plugin memory (if they offer it) — copy key learnings into a markdown doc per site.
2. In your Claude/Cursor session connected to wplab + the target site:
   ```
   /wp-memory-note save: "Past a third-party plugin note: Slider Revolution was disabled 2025-04 — page load 4s → 1.8s. Don't re-enable without testing."
   ```
3. wplab writes this to `~/.config/rolepod-wplab/memory/<site>/notes.md`.

Repeat per critical note. Future Claude sessions will see this on connect.

## Honest "use which"

- **Stay with a third-party plugin** if: in-WP admin UI matters, you primarily click rather than CLI, single-site focus, you've paid for Pro and the memory works for you.
- **Switch to wplab** if: multi-site management, CI/CD integration, MIT license matters, want default-safe posture, AI workflow integrated with rolepod ecosystem.
- **Run both** if: you're evaluating + want to fall back easily.

This guide is intentionally honest, not promotional. If you find a use case where a third-party plugin clearly wins and wplab loses, file an issue — we'll either fix it or document it.
