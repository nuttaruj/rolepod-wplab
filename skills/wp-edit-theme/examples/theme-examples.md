# wp-edit-theme — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — add a WooCommerce hook callback into a theme

### Bad

```text
User: "ใส่ banner ข้อความ 'Free shipping over $50' หลัง product summary"
Lead: file_write {
  path: "wp-content/themes/twentytwentyfive/functions.php",
  content: <appended add_action call>
}
```

Issues:
- Edits PARENT theme directly. Next WordPress / theme update overwrites.
- No child theme, no session group, no validation request acknowledged.

### Good

```text
Lead:
1. rolepod_wp_session_start { label: "woo-shipping-banner" }
   → session_id = sess_4f7a2b...

2. Check existing child theme:
   file_read wp-content/themes/twentytwentyfive-rolepod/style.css
   → 404. Need to scaffold.

3. rolepod_wp_child_theme_create {
     parent_slug: "twentytwentyfive",
     child_slug: "twentytwentyfive-rolepod"
   }
   → 2 files written (style.css + functions.php); ledger rows tagged sess_4f7a2b

4. rolepod_wp_theme_switch_safe {
     new_stylesheet: "twentytwentyfive-rolepod"
   }
   → snapshot OLD (twentytwentyfive); switch; frontend probe → green;
     ledger row category=theme tagged sess_4f7a2b

5. file_write {
     path: "wp-content/themes/twentytwentyfive-rolepod/functions.php",
     content: <append `add_action('woocommerce_after_single_product_summary', ...)`>
   }
   → pre-write `php -l` server-side → ok
   → ledger row category=file tagged sess_4f7a2b

6. wp-health-check → green

7. Surface:
   "Created twentytwentyfive-rolepod child theme.
    Switched active theme to child.
    Added free-shipping-banner callback on woocommerce_after_single_product_summary.
    Session sess_4f7a2b groups all 4 writes — revert with `wp-changes`."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Parent edited | yes (overwrite on update) | no |
| Child theme exists | no | yes |
| Session correlation | none | sess_4f7a2b across 4 rows |
| PHP validated | no (silent WSOD risk) | yes (php -l before commit) |
| Health verified | no | yes |
| Rollback path | manual file_write | `wp-changes` bulk-toggle 4 rows |

## Scenario 2 — change theme.json color palette

### Bad

```text
file_write {
  path: "wp-content/themes/<theme>/theme.json",
  content: <full new theme.json with palette change>
}
```

Then immediately wonder why the Site Editor doesn't show the new colors.

Issues:
- Full-replace pattern (overwrites typography, spacing, layout).
- No `JSON.parse` pre-check (a typo = Site Editor white-page).
- No cache flush after write (object cache holds old theme.json).

### Good

```text
1. file_read wp-content/themes/<theme>/theme.json → 1.5 KB JSON

2. Patch ONLY settings.color.palette in memory (preserve other keys).

3. file_write { path: ".../theme.json", content: <patched JSON> }
   → MCP: JSON.parse OK before sending
   → companion: write success
   → MCP: auto-flushObjectCache (path ends theme.json → auto-trigger)
   → ledger row category=file

4. rest_request GET /wp/v2/global-styles/<id>?context=edit
   → confirms new palette resolved server-side

5. wp-health-check → green
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Patch scope | full replace | palette key only |
| JSON validated | no | yes (Node side + companion side) |
| Cache flushed | no — editor stale | yes — auto on theme.json write |
| Verification | none | global-styles read-back |

## Scenario 3 — switch theme from A to B (production)

### Bad

```text
wp_cli_run { args: ["theme", "activate", "kadence"] }
```

If Kadence requires a plugin that isn't installed → frontend renders white. User panic. Recovery = SSH in and manually `wp theme activate twentytwentyfive`.

### Good

```text
rolepod_wp_theme_switch_safe {
  new_stylesheet: "kadence",
  confirm_production: true  // user typed back hostname per skill convention
}

What happens inside:
1. Read current active theme: twentytwentyfive
2. Snapshot twentytwentyfive → wp-content/uploads/rolepod-wp-theme-snapshots/
   twentytwentyfive-20260527-014523.tar.gz (8.4 MB)
3. wp-cli theme activate kadence
4. REST GET / → status 500 (Kadence needs Kadence Blocks plugin, not installed)
5. AUTO-ROLLBACK:
   - wp-cli theme activate twentytwentyfive
   - theme/restore from the snapshot path
6. Returns: {
     switched: false,
     rolled_back: true,
     reason: "post-switch health check failed; old theme + snapshot restored"
   }
7. wp-health-check → green (original twentytwentyfive back)

Surface to user: "Kadence activation failed health-check. Auto-rolled back to
twentytwentyfive. Snapshot kept at <path>. Investigate Kadence requirements
(likely missing Kadence Blocks plugin) before retrying."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Snapshot before switch | no | yes (8.4 MB tar.gz) |
| Auto-rollback on red | no | yes (within seconds of detection) |
| User notified of cause | no | yes (specific reason) |
| Manual SSH recovery needed | yes | no |
| Production downtime | minutes-hours | seconds |
