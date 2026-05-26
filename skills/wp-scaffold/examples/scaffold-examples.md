# wp-scaffold — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — scaffold a Gutenberg block

### Bad

```text
scaffold_block {
  target_id,
  block_slug: "testimonial-card",
  title: "Testimonial Card",
  allow_destructive: true
}
```

Issues: no namespace (block slug must be `<namespace>/<name>`), no `plugin_slug` (host), no `render_strategy` (defaults to dynamic but unclear).

### Good

```text
1. Check the target host plugin exists:
   file_read { target_id,
     path: "wp-content/plugins/my-team-blocks/my-team-blocks.php" }
   → 200, plugin is real.

2. Plan with user:
   "I will scaffold a dynamic Gutenberg block:
     - namespace: my-team
     - name: testimonial-card
     - host plugin: my-team-blocks
     - render: dynamic (PHP-rendered, supports filters)
   Files to create:
     - wp-content/plugins/my-team-blocks/blocks/testimonial-card/block.json
     - .../testimonial-card/index.js
     - .../testimonial-card/render.php
     - .../testimonial-card/style.css
   OK?"

3. User: "yes"

4. Call:
   scaffold_block {
     target_id,
     plugin_slug: "my-team-blocks",
     block_slug: "my-team/testimonial-card",
     title: "Testimonial Card",
     category: "design",
     icon: "format-quote",
     render_strategy: "dynamic",
     allow_destructive: true
   }

5. Surface manifest (4 files written, 0 backups).
6. Next step: register on plugin activate, then `wp-edit-design` to drop the block.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Namespace | missing | present (`my-team/`) |
| Host plugin | unknown | verified existing |
| Render strategy | default-implicit | explicit (`dynamic`) |
| File paths | guessed | manifest-surfaced |
| Next step | none | concrete |

## Scenario 2 — scaffold a plugin

### Bad

```text
scaffold_plugin {
  target_id,
  slug: "events",
  name: "Events",
  allow_destructive: true
}
```

Issues: slug `events` is dangerously generic (likely collides with The Events Calendar / WP Event Manager / a half-dozen others), no features array (default = bare bootstrap, no REST / no admin / no block).

### Good

```text
1. Decide a unique slug:
   "events" is too generic. Suggest "my-team-events" or "rolepod-events".
   User picks "rolepod-events".

2. Existence check:
   file_read { target_id,
     path: "wp-content/plugins/rolepod-events/rolepod-events.php" }
   → 404. Safe to create.

3. Pick features with user:
   "What does this plugin need?
     - REST endpoint (e.g. /rolepod-events/v1/list)? yes/no
     - Admin settings page? yes/no
     - Gutenberg block? yes/no
     - wp-cli command? yes/no
   "
   User: "REST + admin, no block, no CLI"

4. Scaffold:
   scaffold_plugin {
     target_id,
     slug: "rolepod-events",
     name: "Rolepod Events",
     description: "Event CPT + REST list endpoint + admin page.",
     features: { rest: true, admin: true, gutenberg: false, cli: false },
     allow_destructive: true
   }

5. Manifest: 7 files written (bootstrap + src/Endpoint/List.php + src/Admin/SettingsPage.php + uninstall.php + readme.txt + autoload + LICENSE).
6. Next step: activate via wp-content POST /wp/v2/plugins, then fill in the REST callback in src/Endpoint/List.php.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Slug uniqueness | generic / collides | namespaced |
| Existence check | skipped | done |
| Features picked | implicit | explicit per user |
| Manifest | unknown | every file listed |
| Activation path | guess | concrete next step |
