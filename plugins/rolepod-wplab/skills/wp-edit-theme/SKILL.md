---
name: wp-edit-theme
description: Read or modify theme-level config on a connected target — theme files (functions.php, templates, style.css), theme.json, Site Editor global-styles, child themes, and theme switches. Phase = Build.
when_to_use: user wants to "edit theme / change theme files / make a child theme / set theme.json palette / edit global styles / switch active theme", OR a hook callback needs to live in a theme rather than a custom plugin
tier: 1
phase: build
mode:
  standalone:
    role: edit + guide + verify in one flow
    output: edit diff + impact analysis + verification suggestion
  with-rolepod:
    role: WP edit primitive
    caller: rolepod:implement-plan
    output: edit diff only (parent owns verify/review phases)
---

## Mode selection

If the marker file `$GIT_ROOT/.rolepod/parent-active` exists, follow the
**with-rolepod** mode — return the edit diff only. The parent's
`implement-plan` owns verify + review; do not re-run them here.

Otherwise, follow **standalone** mode — edit + impact analysis + verification
suggestion in one flow.

```bash
GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || GIT_ROOT="$PWD"
if [ -f "$GIT_ROOT/.rolepod/parent-active" ]; then
  MODE=with-rolepod
else
  MODE=standalone
fi
```

# WP Edit Theme

Theme-level writes — the highest-risk surface in WordPress (bad PHP in functions.php = White Screen of Death; bad JSON in theme.json = Site Editor white-page in editor). This skill enforces child-theme-first, pre-write validation, snapshot-before-switch, and atomic session grouping so the user can revert any combination.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER edit a parent theme's files directly when the user owns the site — scaffold a child theme first via `rolepod_wp_child_theme_create`, then edit IN the child. Parent edits get overwritten on theme update; child edits survive.
2. NEVER call `wp_cli_run ["theme", "activate", ...]` directly — use `rolepod_wp_theme_switch_safe` which snapshots the current theme + auto-rolls-back if the new theme breaks the frontend.
3. ALWAYS rely on the file_write pre-write validators (PHP `php -l` server-side, JSON.parse client-side) — they cannot be bypassed. If validation throws, the payload IS broken; do not retry with the same content.
</EXTREMELY-IMPORTANT>

## When to use

- "Edit functions.php" / "add a callback to the theme"
- "Change theme.json palette / typography / spacing"
- "Edit global styles" / "Site Editor preferences"
- "Make a child theme of Twenty Twenty-Five"
- "Switch theme from X to Y"
- "Override a template" (single.php / archive.php / footer.html)

Skip when:
- Page-builder widget tree (Elementor / Divi / Oxygen / Bricks) → `wp-edit-design`.
- New theme from scratch (skeleton bootstrap) → `wp-scaffold`.
- Plugin config (Yoast / RankMath / WPML / Woo / ACF / Forms) → `wp-edit-plugin`.
- Core REST CRUD (posts, options, users) → `wp-content`.

## Boundary

Owns:
- `rolepod_wp_child_theme_create` — scaffold child theme of a parent.
- `rolepod_wp_theme_switch_safe` — snapshot + activate + auto-rollback on red.
- `rolepod_wp_theme_snapshot` — manual snapshot for risky multi-file edits.
- `rolepod_wp_theme_restore` — restore from snapshot.
- `rolepod_wp_file_write` against `wp-content/themes/<slug>/**` — theme files (functions.php, style.css, templates, parts, patterns, theme.json).
- `rolepod_wp_rest_request POST /wp/v2/global-styles/<id>` — Site Editor user customizations (auto-ledgered + cache-flushed).

Does not own:
- Page-builder layouts → `wp-edit-design`.
- New theme bootstrap → `wp-scaffold`.
- Plugin config → `wp-edit-plugin`.

Return / hand off:
- A theme.json change should also trigger a page-builder re-render → after theme.json write, hand to `wp-edit-design` for any layout-side adjustments.
- After theme switch, builder layouts tied to old theme may need re-saving → `wp-edit-design`.
- Bad PHP rejected by pre-write validator → STOP, surface line+col, ask user.

## Inputs to gather

- target_id (always).
- For child theme: parent_slug + child_slug + (optional) name.
- For theme switch: new_stylesheet + (if production) confirm_production=true.
- For theme file edit: path under `wp-content/themes/<slug>/`.
- For global styles: global-styles post id (resolve via `/wp/v2/global-styles/themes/<stylesheet>`).

## Workflow

### 1. Pick the operation

| User intent | Tool |
|---|---|
| edit theme file | `rolepod_wp_file_write` |
| edit theme.json | `rolepod_wp_file_write` (path ends `theme.json` → auto cache flush after) |
| edit global styles | `rolepod_wp_rest_request POST /wp/v2/global-styles/<id>` (auto-ledger + cache flush) |
| create child theme | `rolepod_wp_child_theme_create` |
| snapshot theme | `rolepod_wp_theme_snapshot` |
| restore theme | `rolepod_wp_theme_restore` |
| switch active theme | `rolepod_wp_theme_switch_safe` |

### 2. Session-group multi-file edits

For multi-file work (e.g. add a feature that touches functions.php + template + theme.json):
```
1. rolepod_wp_session_start { label: "add-product-banner" }
   → returns session_id, sets env so all writes auto-group
2. ...file_write calls...
3. If anything goes wrong:
   rolepod_wp_changes_query { source_session: <id> } → see all writes
   rolepod_wp_changes_toggle_bulk { ids: <all>, applied: false } → atomic revert
```

### 3. Child-theme-first for parent edits

If editing an installed parent theme (e.g. Twenty Twenty-Five, Astra, Kadence), default to:
```
1. rolepod_wp_child_theme_create { parent_slug, child_slug: "<parent>-rolepod" }
2. rolepod_wp_theme_switch_safe { new_stylesheet: "<child>" }
3. file_write into the child dir
```

Only edit parent directly if user is the theme AUTHOR (uncommon).

### 4. Pre-write validation

Validators run automatically inside `file_write`:
- `.php` files → companion runs `php -l` server-side. Reject on syntax error with line + message.
- `.json` files → MCP runs `JSON.parse` client-side. Reject on parse error.

If validation throws, do NOT retry the same content. Read the error, fix the payload.

### 5. Verify after write

- `wp-health-check` after every theme file edit.
- For theme.json: also `GET /wp/v2/global-styles/<id>` to confirm the new theme.json keys resolve.
- For theme switch: implicit (auto-rollback runs if frontend GET fails).

## If a matching Rolepod agent is available

- `rolepod:ui-ux-designer` for theme.json palette / typography decisions + accessibility audit.
- `rolepod:frontend-developer` for template + functions.php logic.
- `rolepod:backend-developer` for complex callbacks in functions.php.

## If no matching agent is available

1. Pick the operation from the table.
2. If parent edit → child-theme-first.
3. Session-start for multi-file work.
4. Write (validators run automatically).
5. wp-health-check.
6. If broken → toggle via `wp-changes` (or auto-rollback for theme switch).

## Output

No durable artifact per call. The Change Ledger row IS the rollback artifact. For theme switches, the `.tar.gz` snapshot at `wp-content/uploads/rolepod-wp-theme-snapshots/` is the canonical restore source.

## Examples

Read EVERY time before first parent-theme edit on a target — the child-theme-first pattern is in here:
- `examples/theme-examples.md` — good vs bad functions.php edit; good vs bad theme switch; good vs bad theme.json palette change.

## References

Load when:
- Working with theme.json schema (palette / typography / spacing / layout / patterns):
  - `references/theme-json-schema.md` — block-theme config shape, common pitfalls (preset prefix `var:preset|color|<slug>`, slug vs name collisions, custom property emission).
- Working with template hierarchy + parts:
  - `references/template-hierarchy.md` — single vs archive vs front-page, when override fires.

## Hard stops

- PHP pre-write validator returns `PHP_SYNTAX_ERROR` → STOP, surface line + message; do not retry with same content.
- JSON pre-write validator throws → STOP, surface line; do not retry with same content.
- `wp_theme_switch_safe` returns `rolled_back: true` → STOP, the new theme broke the frontend; investigate the new theme (or its required plugins) before retrying.
- `wp_child_theme_create` returns `CHILD_THEME_ALREADY_EXISTS` → STOP, ask the user whether to delete the existing child first OR pick a different slug.
- About to edit parent theme directly (user is NOT the theme author) → STOP, suggest child-theme-first.

## Full Rolepod enhancement

Full Rolepod adds a "design system" group: theme.json + global-styles + custom CSS + font registrations all tagged with the same source_session, revertable as one atomic operation. Standalone, the user runs `rolepod_wp_session_start` manually for the same grouping.

## Next phase

- After theme.json / global-styles → `wp-edit-design` to update any builder layouts that depend on the new tokens.
- After theme switch → `wp-health-check` + spot-check 3 user-visible URLs.
- If broken → `wp-changes` to toggle off the recent writes; restored snapshot is in `wp-content/uploads/rolepod-wp-theme-snapshots/`.
