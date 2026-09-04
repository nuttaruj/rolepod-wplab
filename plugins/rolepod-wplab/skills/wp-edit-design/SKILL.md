---
name: wp-edit-design
description: Read or modify page-builder layouts on a connected target — Elementor, Divi, Oxygen, Bricks widget trees. Phase = Build.
when_to_use: user wants to design / change a page visually via a page builder, OR mentions any of "elementor / divi / oxygen / bricks"
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

# WP Edit Design

Page-builder layout writes. Auto-detects the active builder, backs up before overwrite, and writes the builder-native data shape. Theme-level config (theme.json, global-styles, child themes, theme switch) lives in `wp-edit-theme`.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. **Native widget FIRST — HTML widget is a LAST RESORT.** Before writing any builder data, open `references/builders/<builder>.md` and `references/patterns.md`. Find a recipe that matches the mockup section, compose native widgets per recipe + theme CSS classes. Use the HTML widget only when no native widget covers the visual (terminal, marquee, scramble headline). One big HTML widget per section defeats the point of the page builder — the user must be able to drag/drop and edit each text/image/button via the builder UI.
2. NEVER overwrite a builder's widget tree without reading `backup_path` from the response. There is no `backup: true` parameter and no `<key>_wplab_backup` meta row. The adapter snapshots the previous meta value to a file under `wp-content/uploads/rolepod-wp/backups/` ONLY when that meta already had a value; otherwise `backup_path` is `null` and nothing was saved.
3. NEVER hand-write Divi shortcodes / Oxygen JSON / Bricks JSON / Elementor `_elementor_data` without first reading the existing structure via `*_read` — every builder has version-specific shape quirks (Elementor `widgetType` capitalization, Divi `et_pb_*` opening tags, Oxygen flat-array container refs).
4. ALWAYS run `wp-health-check` on the target after a global-styles or theme.json write — bad JSON in those surfaces breaks the Site Editor irrecoverably on screen but the REST returns 200, so the failure mode is invisible until reload.
5. After any non-trivial page build → run `rolepod_wp_elementor_validate_data` (catches setting shape mismatches like the legacy `icon` Array bug) AND `rolepod_wp_elementor_html_audit` (refuses if HTML widget count > 30% of total). Then `rolepod_wp_elementor_publish` to flush CSS + bump theme asset filemtime.
</EXTREMELY-IMPORTANT>

## When to use

- "Design a landing page in Elementor"
- "Change the Divi hero section"
- "Update Oxygen breakpoints"
- "Modify Bricks widget order"

Skip when:
- "Set theme.json palette" / "edit global styles" / "switch theme" / "make a child theme" → `wp-edit-theme`.
- The content is core (paragraphs/headings in classic or Gutenberg) → `wp-content`.
- The plugin's own settings (Yoast post meta, ACF fields) → `wp-edit-plugin`.
- Creating a new block/theme from scratch → `wp-scaffold`.

## Boundary

Owns:
- `rolepod_wp_elementor_{read,write}` — `_elementor_data` widget tree.
- `rolepod_wp_divi_{read,write}` — `et_pb_*` shortcode tree in post_content.
- `rolepod_wp_oxygen_{read,write}` — Oxygen JSON in `ct_builder_*` post meta.
- `rolepod_wp_bricks_{read,write}` — Bricks JSON in `_bricks_page_content_2` meta.

Does not own:
- theme.json / global-styles / child-theme / theme-switch → `wp-edit-theme`.
- Plugin settings (Yoast / RankMath / WPML / WooCommerce / ACF / Forms) → `wp-edit-plugin`.
- Block-pattern registration in PHP → `wp-scaffold`.
- New theme bootstrap → `wp-scaffold`.

Return / hand off:
- The builder is not active → tell user to install + activate, OR work in core Gutenberg (`wp-content`).
- The change affects SEO meta → after design write, hand off to `wp-edit-plugin` for Yoast/RankMath.

## Inputs to gather

- target_id.
- For builder edits: `page_id` (post/page ID) + the builder name (or `auto-detect`).
- For theme.json: theme slug (active theme by default) + JSON patch.
- For global-styles: the global-styles post ID (one per theme).

## Workflow

### 1. Detect the active builder

If the user named one ("edit in Elementor"), use it. Else call `rolepod_wp_builder_detect` (Phase 6.2) which inspects the active plugin list. Falls back to per-builder `*_read` probes returning `detected: true`. See `references/builder-formats.md` for the per-builder detection signal.

### 2. Open the builder catalog

Before constructing a widget tree, READ the relevant builder catalog:
- `references/builders/elementor.md` — widget list + settings + quirks + CSS-to-widget-DOM map
- `references/builders/bricks.md`, `divi.md`, `gutenberg.md` — same shape for the other supported builders

Also read `references/patterns.md` — mockup pattern → recipe map (P-001 hero, P-002 feature grid, P-003 FAQ accordion, etc). Each pattern lists the exact widget composition + theme CSS classes + known quirks.

### 3. Read the current tree

Always read before write. The structures are non-obvious — see `references/builder-formats.md` for each shape. When CLONING from an existing page, use `rolepod_wp_elementor_template_export` to dump that page's tree.

### 4. Plan the diff (with native-first decision)

For each section of the mockup, follow the decision flowchart in `references/patterns.md`:

```
1. Pattern match in patterns.md? → use the recipe.
2. Otherwise look up a widget in the builder catalog that covers ≥70% of the visual.
3. Compose: section + columns + native widgets + _css_classes.
4. Only when no native widget fits → HTML widget per CARD (NOT per section).
5. If the entire section is a single decorative block (terminal, marquee) → ONE HTML widget for that section is acceptable.
```

Describe the change to the user in plain text BEFORE writing the new tree: "I will add a 3-column section with `icon-box` widgets X, Y, Z between the current hero and the testimonial block." If the user has not approved, do not write.

### 5. Validate BEFORE write (Elementor)

Run `rolepod_wp_elementor_validate_data` on the section tree you're about to commit. Catches setting shape mismatches (legacy `icon` Array bug, unknown setting keys, wrong value types) against the live widget schema fetched from the target.

### 6. Write with backup

Adapter `*_write` calls take `allow_destructive` and `confirm`, not `backup`. Each returns `backup_path`: the file holding the previous meta value, or `null` when there was no previous value to save. Surface that path so the user can roll back manually. For Elementor specifically, prefer `rolepod_wp_elementor_template_apply` — handles `_elementor_data` + flags + element id regeneration + cache invalidation atomically.

### 7. Audit (Elementor)

After write, run `rolepod_wp_elementor_html_audit`. Reports HTML widget percentage per page + lists candidates for refactoring to native widgets. If the audit reports > 30% HTML widget, consider a refactor pass.

### 8. Publish

For Elementor, run `rolepod_wp_elementor_publish(post_id)` — runs `wp elementor flush-css` + `wp cache flush` + bumps `filemtime()` on every `*.css`/`*.js` under the active theme's `assets/` dir + (optionally) warm-fetches the permalink.

### 9. Verify

Call `wp-health-check`. If the change touched theme.json or global-styles → also `rest_request GET /wp/v2/global-styles/<id>` to confirm the new value is loadable. For visual verification, run `rolepod-uiproof`'s `verify-ui` flow with text_visible assertions for each new section's headline.

## If a matching Rolepod agent is available

- `rolepod:ui-ux-designer` for layout decisions + accessibility checks.
- `rolepod:frontend-developer` for component-level JS/CSS.

## If no matching agent is available

1. Detect builder.
2. Read current tree.
3. Describe diff to user, wait for OK.
4. Write with backup.
5. Health-check.

## Output

No durable artifact per call. The rollback artifact is the file at `backup_path`, under `wp-content/uploads/rolepod-wp/backups/`. It is absent (`null`) whenever the meta key had no prior value.

## Examples

Read when constructing a widget tree non-trivially or when the diff is multi-section:
- `examples/design-examples.md` — good vs bad Elementor section edit; good vs bad theme.json palette change.

## References

Load before the FIRST write for any given builder on a target:
- `references/builder-formats.md` — per-builder data shape, detection signal, common pitfalls (Elementor widget vs section vs column, Divi shortcode escaping, Oxygen flat-array refs, Bricks element nesting).
- `references/builders/elementor.md` — Elementor widget catalog + settings + quirks + CSS-to-widget-DOM map. **READ before writing `_elementor_data`.**
- `references/builders/bricks.md` — Bricks element catalog.
- `references/builders/divi.md` — Divi module catalog.
- `references/builders/gutenberg.md` — Gutenberg core blocks + popular block library catalog.
- `references/builders/oxygen.md` — Oxygen primitives catalog.
- `references/patterns.md` — **builder-agnostic mockup pattern → recipe map**. P-001 through P-012 cover hero, feature grid, FAQ, stat row, pricing, process, portfolio, marquee, terminal, big CTA, header, footer. READ for every page build — most mockup sections have a canonical recipe.

### Decision rule: native vs HTML widget

The single most important rule for AI-driven page builds. Posted prominently in every catalog. Restated:

```
For each section of the mockup:

1. Look up the pattern in references/patterns.md.
   - Match? → Use the recipe exactly. Done.

2. No pattern match? → Open the relevant builder catalog.
   - Find a widget that covers ≥70% of the visual.
   - Compose: section + column + that widget + _css_classes.

3. No native widget fits? → HTML widget PER CARD (NOT per section).
   - e.g., a 3-tier pricing row = section + 3 columns + HTML widget per tier card,
     NEVER one HTML widget for the whole row.

4. Single decorative block (terminal, marquee, scramble headline)?
   - One HTML widget for that section is acceptable.

5. After build:
   - rolepod_wp_elementor_validate_data → catches setting shape errors
   - rolepod_wp_elementor_html_audit → refuses if HTML widget > 30%
   - rolepod_wp_elementor_publish → flushes + warm-fetches
```

## Hard stops

- `*_write` returns `BUILDER_NOT_ACTIVE` → STOP, tell user to activate the plugin or pick a different builder.
- `*_write` returns `backup_path: null` → the previous tree was NOT saved (the meta key was empty, or the snapshot never ran). There is no `BACKUP_FAILED` error code; nothing stops you. Decide deliberately before writing forward.
- Theme.json JSON parse fails server-side → STOP, surface the line/column from `json_last_error`; ask user to confirm the patch.

## When another MCP owns Elementor

Elementor has announced an official MCP — "coming soon" as of 2026-09-04, not
shipped — and Premium Addons for Elementor ships one today. Either may be
connected alongside this server, and then two toolsets offer overlapping
Elementor operations.

**Prefer the Elementor-native server for ordinary page building.** Creating
widgets, editing their settings, applying templates: it speaks Elementor's own
model and will track Elementor's changes faster than an outside adapter can.

**Use `rolepod_wp_elementor_*` when:**

| Situation | Why |
| --- | --- |
| No Elementor-native MCP is connected | These are the only Elementor tools present |
| The target is SSH, Docker, or a remote REST site | An in-WordPress MCP runs on one site; wplab reaches whatever it is connected to |
| `rolepod_wp_elementor_widget_attribute` | Persists `data-*` attributes that Elementor's render strips, via `_rolepod_widget_attrs` meta + a `wp_footer` bridge. A server that builds native Elementor structure is the thing that strips them, so it will not undo this for you |
| The edit must be revertible | Writes land in the change ledger; `rolepod_wp_changes_query` and `rolepod_wp_changes_panic` can undo them |
| Pre-write validation | `rolepod_wp_elementor_validate_data` and `rolepod_wp_elementor_html_audit` catch malformed `_elementor_data` before it reaches the database |

**Say which server you used.** An Elementor page edited by two different tools
is confusing to debug later; naming the one you chose, once, costs a sentence.

## Full Rolepod enhancement

Full Rolepod adds visual-diff confirmation via the `rolepod-uiproof` sibling (snapshot before + after, surface side-by-side). Standalone, the user reviews live.

## Next phase

- Verify reachable → `wp-health-check`.
- If SEO meta needs updating for the new page → `wp-edit-plugin`.
- If iterating the layout → loop back to `wp-edit-design`.
