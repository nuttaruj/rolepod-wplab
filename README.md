# rolepod-wplab

> **🌐 New here? See [what AI can actually do on your WordPress site](https://nuttaruj.github.io/rolepod-wplab/) — plain-English breakdown of the 3 setup tiers.**

**rolepod-wplab gives Claude Code, Cursor, Codex CLI, and Gemini CLI a full WordPress operations toolkit — so the AI can actually wp-cli, edit page builders, audit security, migrate dev→staging, and (opt-in) run guarded `execute-php` against any WordPress site instead of guessing.**

One MCP server, 89+ tools, 14 skills, 4 connection kinds (local path / REST + App Password / SSH / Docker). Default-safe — runs wp-cli + REST + scoped fs out of the box. Install the [`rolepod-wp`](https://github.com/nuttaruj/rolepod-wp) WordPress plugin to unlock `execute-php` + runtime introspection + the **one-click pair** setup wizard.

## Standalone vs Combined

**Standalone:** complete WordPress operations toolkit. 14 skills + 131 MCP tools
cover the full lifecycle — connect, introspect, edit, verify, migrate. Use
directly via skill commands. No external dependencies.

**Combined with rolepod parent (v2.7+):** wplab phase-flavored skills narrow
to WP-specific tool roles, deferring workflow orchestration to parent. Same
14 skills, smarter division of labor. Detection is a single filesystem
marker (`<git-root>/.rolepod/parent-active` containing `v1`) written by the
parent's SessionStart hook — no install-time coupling, no env-var
propagation problems across Claude Code's subprocess boundaries.

### Mode summary

| wplab skill | standalone role | with-rolepod role |
|---|---|---|
| `wp-diagnose` | primary debug entry | evidence for parent's `debug-issue` |
| `wp-health-check` | full smoke test | snapshot for parent's `check-work` |
| `wp-changes` | change audit | summary for parent's `review-code` |
| `wp-full` | tour + flow | tool loader (parent owns flow) |
| `wp-scaffold`, `wp-edit-*` | edit + guide + verify | edit primitives for parent's `implement-plan` |
| `wp-migrate`, `wp-connect`, `wp-pair-setup`, `wp-introspect`, `wp-execute-php`, `wp-content` | unchanged tools | unchanged tools |

### Install combos

| Install | Unlocks |
|---|---|
| wplab alone | full WordPress dev toolkit |
| wplab + rolepod parent | + workflow discipline, evidence handoff, multi-phase gates |
| wplab + uiproof | + browser-verified WP changes, a11y on themes, visual diff on migrations |
| all three | full WP dev flow with verified evidence at every phase |

Evidence path convention:

- standalone: `.rolepod-wplab/artifacts/<ts>/`
- with-parent: `.rolepod/evidence/<ts>-rolepod-wplab-<skill>/`

Manifest schema (Extension Protocol v1): `src/lib/rolepodEvidence.ts`.

## What it helps with

- **Connect any WP install in one command.** `connect_local`, `connect_rest`, `connect_ssh`, `connect_docker` — same tool surface, four ways to reach a site. App Passwords stored in the OS keychain, never echoed.
- **One-click pair via companion.** Admin opens Tools → WPLab Setup → clicks "⚡ Generate setup prompt" → pastes the prompt into the AI → AI calls `rolepod_wp_pair { siteurl, pair_token }` and is connected with full power tools. Token single-use, 60-min TTL.
- **Edit page builders without leaving chat.** `divi_{read,write}`, `oxygen_{read,write}`, `bricks_{read,write}`, `elementor_{read,write}` — all backed up before overwrite.
- **Bulk SEO + WPML + ACF + Woo writes.** `yoast_write`, `rankmath_write`, `wpml_write` (link translations, duplicate for translation), `woo_write` (bulk price updates), `acf_write`.
- **Scaffold blocks, plugins, themes, patterns.** `scaffold_block`, `scaffold_plugin`, `scaffold_theme`, `scaffold_pattern` — register-block-type-ready files into existing themes/plugins.
- **Audit + migrate across many sites.** `audit_security`, `audit_many` (consolidated report for N sites), `migrate_dryrun` + `migrate_data` (plugin version sync dev→staging), `clone` (full db + wp-content + URL rewrite).
- **Diagnose + back up before risky ops.** `diagnose` (plugin conflicts / slow queries / large autoloads / php errors), `backup_create` + `backup_restore`, `cache_tool`, `cron_tool`, `mail_test`.
- **Safe `execute-php` (companion only).** AST screen on Node side AND PHP side, production-block unconditional, append-only audit log.

## The 14 skills

| Skill | Wraps | What it does |
|---|---|---|
| `/wp-pair-setup` | `rolepod_wp_pair` | Redeem a companion-issued pair token → mint App Password → store in vault → open Target. Single-use, 60-min TTL. |
| `/wp-health-check` | `rolepod_wp_health_check` | Versions, db_ok, rest_ok, wp_cli_ok, companion_ok, warnings. |
| `/wp-scaffold-block` | `rolepod_wp_scaffold_block` | Generate `block.json` + `index.js` + `render.php` (dynamic) into an existing plugin. |
| `/wp-scaffold-plugin` | `rolepod_wp_scaffold_plugin` | Plugin skeleton (REST endpoint + admin page + Gutenberg + CLI command). |
| `/wp-scaffold-theme` | `rolepod_wp_scaffold_theme` | Theme skeleton (theme.json + functions.php + style.css + templates). |
| `/wp-audit-security` | `rolepod_wp_audit_security` | Core/plugin/theme updates + weak admin scan + WP_DEBUG check. Markdown or JSON. |
| `/wp-audit-woo` | `rolepod_wp_woo_read` | WooCommerce products / orders / settings / shipping / payments. |
| `/wp-edit-elementor` | `rolepod_wp_elementor_{read,write}` | Dump + replace `_elementor_data` widget tree. Backs up first. |
| `/wp-introspect` | `rolepod_wp_introspect` | Hooks / transients / options / request-state. Requires companion. |
| `/wp-execute-php` | `rolepod_wp_execute_php` | PHP eval against the live runtime. Companion + `power` profile + non-prod. AST-screened. |
| `/wp-migrate-dryrun` | `rolepod_wp_migrate_dryrun` | Plan diff between source + dest target before `migrate_data`. |

Every skill is **single-backend** — calls the rolepod-wplab server and only this server. If the server is unavailable, the skill fails with a clear diagnostic.

## Install

Pick your CLI. All install paths share the same MCP server (`@rolepod/wplab` on npm) and the same skill set.

### Claude Code (recommended)

```bash
# Install
claude plugin marketplace add nuttaruj/rolepod-wplab
claude plugin install rolepod-wplab@rolepod-wplab

# Update
claude plugin marketplace update rolepod-wplab
claude plugin install rolepod-wplab@rolepod-wplab

# Uninstall
claude plugin uninstall rolepod-wplab@rolepod-wplab
claude plugin marketplace remove rolepod-wplab
```

The plugin auto-registers the 14 `/wp-*` skills AND spawns the MCP server (`npx -y @rolepod/wplab@latest serve`) on session start.

### Cursor IDE

Cursor's plugin marketplace is enterprise-only (Free / Pro cannot install marketplace plugins). For everyone else, drop the workspace MCP config:

```bash
# Per project
mkdir -p .cursor
curl -fsSL https://raw.githubusercontent.com/nuttaruj/rolepod-wplab/main/.cursor/mcp.json -o .cursor/mcp.json

# Or global (across every project)
mkdir -p ~/.cursor
curl -fsSL https://raw.githubusercontent.com/nuttaruj/rolepod-wplab/main/.cursor/mcp.json -o ~/.cursor/mcp.json
```

Then **fully restart Cursor** — MCP servers load only at startup. Verify under **Settings → MCP**.

**Update:** re-run the `curl` command above to overwrite `.cursor/mcp.json`, then restart Cursor.
**Uninstall:** delete `.cursor/mcp.json` (or `~/.cursor/mcp.json` for the global install) and restart.

Skills are not auto-registered under Cursor (no unified plugin format yet). The 131 MCP tools are still available; invoke them by name in chat (`Use rolepod_wp_pair to …`).

### Codex CLI

```bash
# Install (reads .agents/plugins/marketplace.json + .codex-plugin/plugin.json)
codex plugin marketplace add nuttaruj/rolepod-wplab
codex plugin add rolepod-wplab@rolepod-wplab

# Update
codex plugin marketplace remove rolepod-wplab
codex plugin marketplace add nuttaruj/rolepod-wplab
codex plugin add rolepod-wplab@rolepod-wplab

# Uninstall
codex plugin remove rolepod-wplab@rolepod-wplab
codex plugin marketplace remove rolepod-wplab
```

If the MCP server doesn't show up in Codex's **Settings → MCP** after install, fully restart Codex — MCP servers load only at startup.

Or drop-in config (no plugin install — just MCP wiring, also works as "uninstall via config-edit"):

```toml
# ~/.codex/config.toml
[mcp_servers.rolepod-wplab]
command = "npx"
args = ["-y", "@rolepod/wplab@latest", "serve"]
```

### Gemini CLI

```json
// ~/.gemini/settings.json
{
  "mcpServers": {
    "rolepod-wplab": {
      "command": "npx",
      "args": ["-y", "@rolepod/wplab@latest", "serve"]
    }
  }
}
```

**Update:** no command needed — `npx -y @rolepod/wplab@latest serve` pulls the latest version on every Gemini restart.
**Uninstall:** remove the `rolepod-wplab` entry from `~/.gemini/settings.json` and restart.

Skills are not auto-registered under Gemini (no unified plugin format yet — `gemini-extension.json` is still in flux). The 131 MCP tools are still available; invoke them by name in chat (`Use rolepod_wp_pair to …`).

### Direct npm (any MCP-aware tool)

```json
{
  "mcpServers": {
    "rolepod-wplab": {
      "command": "npx",
      "args": ["-y", "@rolepod/wplab@latest", "serve"]
    }
  }
}
```

131 MCP tools (`rolepod_wp_*`) will appear in your client. Skills are not surfaced via this path — call the tools by name.

**Update:** `npx -y @rolepod/wplab@latest …` always fetches the latest published version. Pin to an exact version (e.g. `@rolepod/wplab@1.13.0`) if you want lockstep behavior.
**Uninstall:** remove the `rolepod-wplab` entry from your client's MCP config.

## Quick start

### Path A — one-click pair (recommended)

```bash
# 1. Install the Rolepod for WordPress plugin on your WP site (stable URL, always latest)
wp plugin install \
  https://github.com/nuttaruj/rolepod-wp/releases/latest/download/rolepod-wp.zip \
  --activate

# 2. WP admin → Tools → Rolepod WP Setup → ⚡ Generate setup prompt → copy

# 3. Paste prompt into Claude Code / Cursor / Codex / Gemini → AI calls rolepod_wp_pair → done
```

The pair token is single-use, 60-min TTL. The plugin mints a WP Application Password named `wplab-pair-<UTC-timestamp>` under your admin user — revocable from `profile.php` at any time.

> The WP plugin (`rolepod-wp`) is the WordPress arm of the broader [Rolepod ecosystem](https://github.com/nuttaruj/rolepod), parallel to `rolepod-uiproof`. Source: [`nuttaruj/rolepod-wp`](https://github.com/nuttaruj/rolepod-wp). End users do not need to read that repo — everything they need is on this page.

### Path B — manual (no companion required)

```bash
# 1. Create an App Password: WP admin → Users → Profile → Application Passwords
# 2. Store locally (vault uses OS keychain when available)
rolepod-wplab credentials add walnutztudio.com

# 3. In your AI CLI:
#    "เชื่อม walnutztudio.com แล้ว run health_check"
# Lead → rolepod_wp_connect_rest { url: "https://walnutztudio.com" }
```

Path B works without the companion plugin — you get all 131 MCP tools EXCEPT `execute_php`, `introspect`, `hook_state`, `mail_test` (those need the companion).

## Verify your setup

```bash
npx rolepod-wplab doctor
```

```
✓ Node ≥20                       24.14.0
✓ rolepod-wplab MCP binary       1.2.2
✓ wp-cli on PATH                 wp-cli 2.12.0
✓ Credential vault writable      ~/.config/rolepod-wplab/credentials.json (or keychain)
✓ Memory dir writable            ~/.config/rolepod-wplab/memory/
• Docker daemon (optional)       Not running — only needed for connect_docker
• SSH agent (optional)           Not configured — only needed for connect_ssh
```

`✓` = ready · `•` = optional · `✗` = blocker.

## What's inside

- **131 MCP tools** — connectivity (4 kinds) + wp-cli passthrough + typed CRUD + page-builder adapters (Elementor / Divi / Oxygen / Bricks) + SEO/i18n (Yoast / RankMath / WPML) + WooCommerce + ACF + forms (Gravity / CF7 / WPForms) + cron + cache + mail + clone + backup + diagnose + scaffold (block / plugin / theme / pattern) + REST dump + user sessions + companion-gated (execute_php / introspect / hook_state) + pair (one-click setup). All prefixed `rolepod_wp_*`.
- **4 connection kinds** — `LocalTarget` (filesystem + wp-cli), `RestTarget` (HTTPS + App Password, no shell needed), `SshTarget` (node-ssh), `DockerTarget` (dockerode). Same `Target` interface, same tools.
- **3 profiles** — `strict` / `personal` / `power`. Profile-gated capability map (`power` required for execute_php; `strict` blocks all destructive ops).
- **Safety floor that always applies** — wp-cli allow-list (3-token prefix match, hard-block on `db reset`/`db drop`/`core multisite-convert`), DB SELECT-only by default, scoped fs (resolves symlinks; refuses paths outside `wp-content/{themes,plugins,uploads}` + `wp-config.php`), AST screen on every `execute_php` payload (Node side + PHP side), production-host glob match with unconditional block on power tools, HTTPS-only RestTarget, OS-keychain credential vault.
- **Per-site memory** — `memory_recall` / `memory_note` / `memory_list` keep context between sessions at `~/.config/rolepod-wplab/memory/<site>/`. Local files, $0, no SaaS.
- **Audit trail** — every companion `execute_php` writes append-only `wplab_audit_<id>.log` (mode 0600) + a 1000-entry FIFO in `wp_options`.

## Companion WP plugin

The [`rolepod-wp`](https://github.com/nuttaruj/rolepod-wp) WordPress plugin (the WP arm of the [Rolepod ecosystem](https://github.com/nuttaruj/rolepod)) is optional. Without it, wplab is a complete wp-cli + REST + scoped fs toolkit. With it, you get:

- **One-click pair** — `Tools → Rolepod WP Setup → ⚡ Generate setup prompt` produces a ready-to-paste prompt for any AI CLI.
- **execute-php** — runtime PHP eval, AST-screened, production-blocked.
- **introspect** — hooks / transients / options / request-state read at runtime.
- **mid-request observation + persistent PHP session**.

```bash
wp plugin install \
  https://github.com/nuttaruj/rolepod-wp/releases/latest/download/rolepod-wp.zip \
  --activate
```

## Use with parent rolepod

If you also use [`rolepod`](https://github.com/nuttaruj/rolepod) (the markdown plugin), its phase skills auto-route WP work to rolepod-wplab when the server is present. The two are **independent**: install rolepod-wplab standalone and get a complete experience via slash commands, or install both together and let parent's phase router pick the right backend automatically.

## Docs

- [docs/RECIPES.md](docs/RECIPES.md) — 23 end-to-end recipes (connect, scaffold, audit, migrate, edit page builders, pair, diagnose, clone, backup).
- [CHANGELOG.md](CHANGELOG.md) — release history.
- [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Sibling repos

- [`rolepod`](https://github.com/nuttaruj/rolepod) — parent ecosystem (markdown plugin + phase router).
- [`rolepod-wp`](https://github.com/nuttaruj/rolepod-wp) — optional WP plugin for runtime PHP context + one-click pair.
- [`rolepod-uiproof`](https://github.com/nuttaruj/rolepod-uiproof) — UI / mobile automation sibling.

---

MIT licensed — see [LICENSE](LICENSE). Independent implementation, written from spec, not derived from any GPL/AGPL WordPress AI plugin. Feedback + runtime reports for Cursor / Codex / Gemini install paths especially welcome via [issues](https://github.com/nuttaruj/rolepod-wplab/issues).
