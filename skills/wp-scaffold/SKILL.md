---
name: wp-scaffold
description: Bootstrap a new Gutenberg block, plugin, theme, or block-pattern skeleton on a connected target — generates files via the companion's fs-write endpoint. Phase = Build.
when_to_use: user wants to "create a new plugin / new block / new theme / new block-pattern", OR mentions scaffolding any of those four artifact types
tier: 1
phase: build
mode:
  standalone:
    role: scaffold + guide WP file creation
    output: scaffolded files + structure walkthrough
  with-rolepod:
    role: WP scaffold primitive
    caller: rolepod:implement-plan
    output: files created (list of paths) — no guide
---

## Mode selection

If `$ROLEPOD_PARENT` is set to `1`, follow the **with-rolepod** mode — return
only the list of files created (absolute paths). Skip the structure walkthrough
and next-step suggestions — the parent's `implement-plan` owns the build flow.

If `$ROLEPOD_PARENT` is unset, follow **standalone** mode — scaffold + guide
the user through structure, conventions, and recommended next steps.

```bash
if [ "${ROLEPOD_PARENT:-}" = "1" ]; then MODE=with-rolepod; else MODE=standalone; fi
```

# WP Scaffold

Single skill, four sub-modes. Picks the right `scaffold_*` tool, scopes destination paths, refuses destructive overwrites, surfaces every file written so the user can review or roll back.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER scaffold without `allow_destructive: true` — the flag is mandatory because file_write is irreversible at REST scale; the explicit ask forces user awareness.
2. NEVER scaffold into an existing slug without first checking it does not exist (`file_read` the bootstrap path, expect 404) — a hidden overwrite into an active plugin breaks the live site.
3. ALWAYS surface every absolute path written + every backup file created — the only reliable rollback is to restore the `.wplab-bak-...` siblings or `rm -rf` the slug dir.
</EXTREMELY-IMPORTANT>

## When to use

- "Create a plugin called X with a REST endpoint."
- "Scaffold a new Gutenberg block called testimonial-card."
- "Build a starter block-theme called my-theme."
- "Register a block pattern called hero-with-cta."

Skip when:
- User wants to EDIT an existing block/plugin/theme → `wp-content` (post editing), `wp-edit-design` (layout), or direct `file_write`.
- User wants to install a plugin from wordpress.org → use core REST `wp/v2/plugins` POST (covered by `wp-content`).

## Boundary

Owns:
- `rolepod_wp_scaffold_block` — block.json + index.js + render.php (dynamic) OR save() (static) + style.css.
- `rolepod_wp_scaffold_plugin` — plugin bootstrap PHP + admin page + REST stub + CLI command stub + Gutenberg block stub.
- `rolepod_wp_scaffold_theme` — theme.json + functions.php + style.css + index.html + parts/ + patterns/.
- `rolepod_wp_scaffold_pattern` — block-pattern PHP registration + JSON metadata.
- All path-scope + production-guard enforcement.

Does not own:
- Filling in business logic — that is post-scaffold `file_write` work.
- Installing an external plugin from wp.org → `wp-content` (uses core `wp/v2/plugins`).
- Editing a scaffolded artifact's content later → core CRUD or builder skills.

Return / hand off:
- After scaffold succeeds → tell user the next concrete step (e.g. "now fill in `src/Endpoint/Hello.php` — call wp-content/file_write to add the callback").
- If the target lacks companion → STOP, scaffold needs fs-write.

## Inputs to gather

- target_id.
- `type`: block | plugin | theme | pattern.
- `slug` (required for plugin / theme / pattern; for block it is `<namespace>/<name>`).
- For block: `plugin_slug` (host plugin) + `title` + `category` + `icon` + `render_strategy` (dynamic / static).
- For plugin: `name` + `description` + features array (rest / admin / gutenberg / cli).
- For theme: `name` + `description` + parent (if child).
- For pattern: `plugin_slug` (host) + `name` + content (Gutenberg block markup).

## Workflow

### 1. Validate inputs

- Slug must be lowercase, hyphenated, no namespace prefix collisions with WP core.
- For block: namespace MUST be present (`my-team/widget`, not `widget`).
- For theme: must NOT collide with active theme.

### 2. Existence check

Call `file_read` on the expected bootstrap path (e.g. `wp-content/plugins/<slug>/<slug>.php`). Expect 404. If 200 → STOP, ask user for a different slug or explicit overwrite OK.

### 3. Plan + confirm

Tell user: "I will create these files: [list]. Each is a fresh write — no overwrite. Confirm?"

### 4. Scaffold

Call the matching `rolepod_wp_scaffold_*` tool with `allow_destructive: true`. The template structure for each is in `templates/scaffold-manifest.md`.

### 5. Surface every file written

For each emitted file: absolute path + bytes. If any file_write returned a `backup_path` (means it overwrote something we missed) → SURFACE THAT TOO, treat as warning.

### 6. Hand off next step

State the next concrete action for the user (fill in REST callback, register block on activate, etc.).

## If a matching Rolepod agent is available

- `rolepod:backend-developer` for the post-scaffold logic fill-in.
- `rolepod:ui-ux-designer` for the new block's CSS / patterns.

## If no matching agent is available

1. Validate inputs.
2. Existence check.
3. Plan with user.
4. Scaffold with `allow_destructive: true`.
5. Surface files + next step.

## Output

Scaffold manifest — `templates/scaffold-manifest.md`. Lists every file written + bytes + backup-if-any.

## Examples

Read when scaffolding for the first time on a target or when picking between dynamic vs static block render:
- `examples/scaffold-examples.md` — good vs bad block scaffold; good vs bad plugin bootstrap features pick.

## References

Inline only. File-emit shapes are encoded into each `rolepod_wp_scaffold_*` tool — the manifest template summarizes them. Tool docstrings in `src/schema/tools.ts` are authoritative.

## Hard stops

- Slug exists → STOP, do not overwrite. Ask user.
- `allow_destructive: false` (or omitted) → tool refuses; surface verbatim.
- Companion missing on RestTarget → STOP, scaffold needs fs-write. Tell user to install `rolepod-wp` v2.1+.
- Production-matched siteurl → STOP, scaffold refuses on production targets unconditionally.

## Full Rolepod enhancement

Full Rolepod adds a post-scaffold "fill in the logic" wizard that opens the new files in sequence and asks the user what each callback should do; standalone, the user fills in via direct `file_write` calls.

## Next phase

- After plugin scaffold → `wp-content` to install + activate via REST `wp/v2/plugins`.
- After block scaffold → `wp-edit-design` to drop the new block into a page layout.
- After theme scaffold → switch the active theme (via REST `wp/v2/themes` or wp-cli `theme activate`), then `wp-health-check`.
- After pattern scaffold → confirm the pattern shows up under `/wp-json/wp/v2/block-patterns/patterns`.
