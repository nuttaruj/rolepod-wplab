# Recipes

Concrete tasks the Lead can hand off to the MCP. Each recipe shows the
natural-language prompt + the MCP tool calls Claude/Cursor/Codex will
issue under the hood + expected output.

## 1 — Connect a local WP install + check health

```
User: "เชื่อม WP ที่ ~/Sites/my-wp + check health"

Lead:
  rolepod_wp_connect_local { path: "/Users/me/Sites/my-wp" }
    → { target_id: "tgt_a1b2c3d4e5f6", siteurl: "http://localhost:8989", wp_version: "6.6.2" }
  rolepod_wp_health_check { target_id: "tgt_a1b2c3d4e5f6" }
    → { db_ok: true, wp_cli_ok: true, rest_ok: false, companion_ok: false, warnings: ["REST check deferred to v0.1"] }
```

## 2 — Connect a remote shared-hosting site over REST

```
Setup (one-time):
  $ rolepod-wplab credentials add walnutztudio.com
    Username: admin
    Application Password: ****
    ✓ stored in keychain

User: "เชื่อม walnutztudio.com"

Lead:
  rolepod_wp_connect_rest { url: "https://walnutztudio.com" }
    → target_id + siteurl + wp_version + companion (null if companion not installed)
```

## 3 — Scaffold a Gutenberg block

```
User: "/wp-scaffold-block testimonial card into my-team plugin"

Lead:
  rolepod_wp_scaffold_block {
    target_id: "tgt_...",
    plugin_slug: "my-team",
    block_slug: "my-team/testimonial-card",
    title: "Testimonial Card",
    render_strategy: "dynamic",
    allow_destructive: true
  }
    → files_written: [4 files under wp-content/plugins/my-team/blocks/testimonial-card/]
       next_steps: ["register_block_type(...)", "wp cache flush"]
```

## 4 — Security audit across 5 client sites (agency-tier)

```
Setup: connect 5 targets first (one connect_rest per site).

User: "audit security ทุก client"

Lead:
  rolepod_wp_audit_many { target_ids: [tid1, tid2, tid3, tid4, tid5] }
    → reports[].summary per site + consolidated_path: ".rolepod-wplab/artifacts/.../audit-many.json"
```

## 5 — Migrate plugin versions dev → staging

```
User: "sync staging plugins to match dev"

Lead:
  rolepod_wp_migrate_dryrun { source: tgt_dev, dest: tgt_staging, scope: ["plugin_versions"] }
    → plan with version_mismatch + only_in_source counts
  (user confirms)
  rolepod_wp_migrate_data {
    source_target_id: tgt_dev,
    dest_target_id: tgt_staging,
    scope: "plugin_versions",
    allow_destructive: true,
    confirm: true
  }
    → applied[] per plugin: install / upgrade / downgrade / noop
```

## 6 — Debug "why isn't this hook firing?" (companion required)

```
Setup: install rolepod-wplab-companion + set ROLEPOD_WPLAB_PROFILE=power.

User: "what fires on wp_loaded?"

Lead:
  rolepod_wp_hook_state { target_id, hook: "wp_loaded" }
    → callbacks: [{ priority, callback_identifier }, ...]
```

## 7 — Bulk update WooCommerce prices

```
User: "+10% on all products"

Lead:
  rolepod_wp_woo_read { target_id, scope: "products", per_page: 100 }
    → loop through products, compute new prices
  rolepod_wp_woo_write {
    target_id,
    op: "bulk_update_prices",
    price_updates: [{ id, regular_price }, ...],
    allow_destructive: true,
    confirm: true
  }
    → { updated: N, failed: 0 }
```

## 8 — Recall site context across sessions

```
User: "what did we change on walnutztudio.com last time?"

Lead:
  (after connect)
  rolepod_wp_memory_recall { target_id, query: "" }
    → summary + notes[] from ~/.config/rolepod-wplab/memory/walnutztudio.com/

After making a change:
  rolepod_wp_memory_note {
    target_id,
    content: "Slider Revolution v6.5 disabled, homepage 4.2s → 1.8s",
    kind: "note"
  }
```

## 9 — Run PHP eval on remote (companion + power profile required)

```
Setup: companion installed + ROLEPOD_WPLAB_PROFILE=power + non-prod target.

User: "count active hooks on init"

Lead:
  (show payload to user, confirm)
  rolepod_wp_execute_php {
    target_id,
    payload: "global $wp_filter; return isset($wp_filter['init']) ? count($wp_filter['init']->callbacks) : 0;",
    confirm: true
  }
    → { return_value: 47, audit_id: "wplab_audit_..." }
```

## 10 — Connect a docker WP fixture for CI

```
Setup: docker compose up -d (your WP + DB containers).

User: "connect docker WP fixture"

Lead:
  rolepod_wp_connect_docker { container_name: "wplab-fixture-wp", wp_path: "/var/www/html" }
    → target_id + siteurl + wp_version
```

## 11 — Edit Divi / Oxygen / Bricks pages (v1.1)

```
User: "rewrite hero shortcode on Divi homepage"

Lead:
  rolepod_wp_divi_read { target_id, page_id: 12 }
    → page.content (Divi shortcode string) + meta.et_pb_use_builder
  (regenerate new shortcode)
  rolepod_wp_divi_write {
    target_id, post_id: 12, content: "<new shortcode>",
    ensure_builder_flag: true, allow_destructive: true, confirm: true
  }
    → bytes_written + backup_path
```

Same pattern works for `rolepod_wp_oxygen_{read,write}` (ct_builder_shortcodes) and `rolepod_wp_bricks_write` (element tree JSON).

## 12 — SEO bulk update (Yoast / Rank Math, v1.1)

```
User: "fix focus keyword + meta_description on top 20 product pages"

Lead:
  (loop product IDs)
  rolepod_wp_yoast_write {
    target_id, post_id: 123,
    focus_keyword: "ergonomic chair",
    meta_description: "...",
    allow_destructive: true, confirm: true
  }
    → updated_fields: [focus_keyword, meta_description]
```

Mirror tool: `rolepod_wp_rankmath_write` (same shape).

## 13 — WPML translation linkage (v1.1)

```
User: "link en page 100 with th post 200 and ja post 300"

Lead:
  rolepod_wp_wpml_write {
    target_id,
    op: "link_translations",
    original_post_id: 100,
    translations: { en: 100, th: 200, ja: 300 },
    allow_destructive: true, confirm: true
  }
    → linked_count: 3
```

## 14 — Form spam triage (v1.1)

```
User: "find recent Gravity Forms spam entries"

Lead:
  rolepod_wp_forms_read { target_id, scope: "list_entries", engine: "gravity", per_page: 100 }
    → items[] with is_spam flag
  (filter spam → list IDs)
  rolepod_wp_forms_write {
    target_id, engine: "gravity", op: "delete_entry", entry_id: 4521,
    allow_destructive: true, confirm: true
  }
```

## 15 — Cron sanity (v1.1)

```
User: "what's scheduled on wp-cron?"

Lead:
  rolepod_wp_cron_tool { target_id, op: "list" }
    → events[] { hook, next_run_relative, recurrence }

User: "fire wp_scheduled_delete now"

Lead:
  rolepod_wp_cron_tool { target_id, op: "run", hook: "wp_scheduled_delete", confirm: true }
```

## 16 — Cache + SMTP smoke (v1.1)

```
User: "flush object cache + test email"

Lead:
  rolepod_wp_cache_tool { target_id, op: "flush_object", confirm: true }
    → flushed: true
  rolepod_wp_mail_test { target_id, to: "me@example.com", confirm: true }
    → delivered: true | source: companion_php | detail: "wp_mail() returned true"
```

## 17 — Backup before risky op (v1.1)

```
User: "back up db before plugin upgrade"

Lead:
  rolepod_wp_backup_create { target_id, scope: ["db"], label: "pre-upgrade" }
    → artifact_dir: ".rolepod-wplab/artifacts/backups/wplab_..._pre-upgrade/"

  rolepod_wp_cli_run { target_id, args: ["plugin","update","--all"], allow_destructive: true }
    (if anything goes south)
  rolepod_wp_backup_restore {
    target_id, artifact_dir: "<above>", scope: ["db"],
    allow_destructive: true, confirm: true
  }
```

## 18 — Full site clone dev → staging (v1.1)

```
User: "spin up staging from dev"

Lead:
  rolepod_wp_clone {
    source_target_id: tgt_dev,
    dest_target_id:   tgt_staging,
    scope: ["db", "wp_content", "plugin_versions"],
    rewrite_urls: true,
    allow_destructive: true,
    confirm: true
  }
    → steps[]: { step:"db", ok:true } / { step:"wp_content", ok:true } /
                { step:"rewrite_urls", detail:"old.com → staging.com" } / { step:"plugin_versions" }
```

## 19 — Site diagnose (v1.1)

```
User: "why is this site slow?"

Lead:
  rolepod_wp_diagnose {
    target_id,
    scopes: ["plugin_conflict_probe", "slow_queries", "large_options", "php_errors"]
  }
    → findings ranked critical/warn/info
    → report_path: ".rolepod-wplab/artifacts/<run_id>/diagnose-report.md"
```

## 20 — Block pattern scaffold (v1.1)

```
User: "scaffold a CTA pattern into my theme"

Lead:
  rolepod_wp_scaffold_pattern {
    target_id,
    host: "theme", host_slug: "twentytwentyfive",
    pattern_slug: "twentytwentyfive/cta-card",
    title: "Call-to-action card",
    content: "<!-- wp:cover --><div class=\"wp-block-cover\">...</div><!-- /wp:cover -->",
    allow_destructive: true
  }
    → file_written: wp-content/themes/twentytwentyfive/patterns/cta-card.php
```

## 21 — REST discovery (v1.1)

```
User: "what REST routes does WC expose?"

Lead:
  rolepod_wp_rest_dump { target_id, filter_namespace: "wc/v3" }
    → namespaces: ["wc/v3"]
    → routes[] with path + methods
```

## 22 — One-click pair via companion (v1.2 — recommended)

```
WP admin (in the browser):
  Tools → WPLab Setup → "⚡ Quick Start"
  Click "Generate setup prompt"
  Copy the prompt that appears (contains pair_token + per-CLI install snippets)

User → paste into Claude / Cursor / Codex / Gemini

AI agent (with wplab plugin installed):
  rolepod_wp_pair {
    siteurl:    "https://walnutztudio.com",
    pair_token: "wplab_pair_<48 hex>"
  }
    → target_id + username + capabilities + app_password_name
    → credential silently stored in OS keychain

AI: rolepod_wp_health_check { target_id }
    → db_ok:true, rest_ok:true, companion_ok:true
```

Token is single-use, 60 min TTL. App Password named `wplab-pair-<timestamp>` — revocable from `profile.php#application-passwords-section` at any time.

## 23 — Setup new target with init wizard (v1.1)

```
$ rolepod-wplab init
  Site URL (https://...): https://walnutztudio.com
  WP username: admin
  Application Password: ****
  ✓ REST reachable
  ✓ Companion present (v1.1.0)
  ✓ stored in vault
  ✓ wrote starter ~/.config/rolepod-wplab/profile.json (profile=personal)

  Claude Code:
    claude mcp add rolepod-wplab -- rolepod-wplab serve
```

## 24 — Audit a wp-admin screen with no human login (v1.2)

Anything behind wp-admin — the plugin list, a settings screen, an admin-only
bug — is reachable without asking anyone for a password or a click.

```
User: "check whether the theme options screen actually renders"

Lead:
  rolepod_wp_admin_one_time_link {
    target_id,
    destination: "https://site.com/wp-admin/themes.php?page=theme_options"
  }
    → { url: "https://site.com/?rolepod_wp_otl=<token>", expiresInSeconds: 300 }

  browser_open { url: <that url> }            # rolepod-uiproof
    → lands in wp-admin, signed in as the issuing admin

  browser_navigate / browser_screenshot / audit_a11y / measure_cwv ...
    → still signed in; the auth cookie lives on the browser context
```

The ladder, in order:

1. **rolepod-uiproof** `browser_open` — the intended pair, nothing else needed.
2. **Any other browser automation on the machine** — a Chrome-extension MCP, a
   Playwright or Puppeteer MCP. The link is a plain URL and the whole handoff,
   so not having uiproof blocks nothing.
3. **A human**, last, only when the machine has no browser automation at all.

Say which rung you are on. On 1 or 2, tell the user you are handling the admin
step yourself and they do not need to log in — otherwise they wait for a prompt
that never comes. On 3, say that no browser automation is available here, so
this one step needs them.

Notes:

- The token is single-use and expires in 5 minutes. That bounds the handoff,
  not the session: once the cookie is set it lasts as long as the browser
  context. Re-mint whenever the context is recreated (`browser_close`, crash,
  a new run).
- Works on a guarded site. `/admin/one-time-login` checks `manage_options` and
  that companion endpoints are on — it does not require AI Full Control.
- **Asking a person to click the link is the last resort**, for when you have
  no browser automation at all.
- First uiproof launch on a machine can take several minutes (large npm
  install). A silent handoff is usually a cold start, not a failure.

**Security.** Whoever opens the URL holds a full admin session. Any recording
of that browser — HAR, Playwright trace, video — captures the auth cookie
along with it. Treat those artifacts as credentials: do not attach them to an
issue, a PR, or a shared bucket.
