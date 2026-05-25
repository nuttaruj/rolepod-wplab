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
