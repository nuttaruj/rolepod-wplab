---
name: wp-content
description: Create, read, update, search posts/pages/users/options/taxonomies via the core WP REST API on a connected target. Phase = Build.
when_to_use: any "create / write / list / read / update" request scoped to WordPress core content (posts, pages, custom post types, users, options, categories, tags, media), without builder-specific markup or plugin adapter writes
tier: 1
phase: build
---

# WP Content

Core-REST CRUD skill. Owns the most common WordPress operations: write a page, list posts, update an option, register a user, query the DB read-only. Anything builder-specific (Elementor JSON, Divi shortcodes) belongs to `wp-edit-design`; anything plugin-specific (Yoast meta, Woo products) belongs to `wp-edit-plugin`.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER post `status=publish` on a brand-new draft without explicit user confirmation — drafts are reversible, publishes are user-visible.
2. NEVER call `rolepod_wp_db_query` with anything other than SELECT — write/update/delete via REST or wp-cli; the db_query path is read-only by design and the guard fires hard.
3. ALWAYS read the existing post (`post_get` or `post_list`) before `post_update` if you do not know the current content — the REST endpoint replaces fields, and overwriting an unknown post loses the live content irrecoverably.
4. NEVER delete a user without `reassign_to` — every post the user authored is destroyed with the account otherwise. `rolepod_wp_user_write(action: delete)` refuses (USER_DELETE_NEEDS_REASSIGN) until you name the inheriting user id.
</EXTREMELY-IMPORTANT>

## When to use

- "Create a landing page with these sections..."
- "List the last 10 posts" / "show all pages" / "find posts containing X"
- "Update the site title to ..." / "change blogname"
- "Add a tag / category"
- "Show me all admins"
- "Query wp_options to see ..."
- Anything `/wp/v2/*` REST surface.

Skip when:

- The content is a builder layout (Elementor / Divi / Oxygen / Bricks) → `wp-edit-design`.
- The content is a plugin config (Yoast SEO meta, WooCommerce product) → `wp-edit-plugin`.
- The content is a custom block / plugin / theme bootstrap → `wp-scaffold`.

## Boundary

Owns:

- `rolepod_wp_post_{get,list,create,update}` for posts/pages/CPTs.
- `rolepod_wp_user_list` (read) + `rolepod_wp_user_write` (create/update/delete).
- `rolepod_wp_term` for taxonomy terms (category / tag / custom), `rolepod_wp_comment` for comment moderation, `rolepod_wp_cpt_scaffold` to register a custom post type.
- `rolepod_wp_option_{get,set}` for the WP-allowed settings surface (siteurl, blogname, etc.).
- `rolepod_wp_db_query` (SELECT only). Output is capped at `max_bytes` (default 64 KB, stdout and stderr each) and the result says `total_bytes` / `returned_bytes` / `truncated`. `truncated: true` means add `LIMIT` or select fewer columns — not run it again unchanged.
- `rolepod_wp_rest_request` for arbitrary `/wp/v2/*` calls.
- `rolepod_wp_rest_dump` to discover routes — per-namespace counts by default (~1 KB); pass `filter_namespace` for one namespace's path/methods table, or `full: true` for all of them (300+ routes, ~50 KB on a plugin-heavy site).

Does not own:

- Builder content (`_elementor_data`, Divi shortcodes, Oxygen JSON, Bricks JSON) → `wp-edit-design`.
- Plugin-specific writes (Yoast post meta, ACF fields, Woo products) → `wp-edit-plugin`.
- File writes outside the REST surface → `wp-scaffold` or `wp-edit-design`.

Return / hand off:

- User wants a layout in Elementor → `wp-edit-design`.
- User wants ACF custom fields on the new post → `wp-edit-plugin`.
- DB SELECT shows a problem worth diagnosing → `wp-diagnose`.

## Inputs to gather

- target_id (always).
- For create: `type` (default `posts`), `title`, `content`, `status` (default `draft`).
- For update: `id` + the fields to change (read the post first if content is unknown).
- For list: `type`, optional `search`, `status`, `per_page`, `page`, `orderby`.
- For options: `name`; for set, `value` + `confirm: true` if on production.
- For rest_request: `path`, `method`, optional `body`/`query`.

## Workflow

### 1. Pick the operation

| User intent                               | Tool                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| create a page/post/cpt                    | `rolepod_wp_post_create`                                                |
| update an existing one                    | `rolepod_wp_post_get` first (if unknown), then `rolepod_wp_post_update` |
| list / search / filter                    | `rolepod_wp_post_list`                                                  |
| upload an image / set a featured image    | `rolepod_wp_media_upload`                                               |
| list users                                | `rolepod_wp_user_list`                                                  |
| create/update/delete a user               | `rolepod_wp_user_write` (delete needs `reassign_to`)                    |
| add/find a category, tag, or custom term  | `rolepod_wp_term` (action=ensure is idempotent)                         |
| approve / spam / trash / delete a comment | `rolepod_wp_comment`                                                    |
| register a custom post type               | `rolepod_wp_cpt_scaffold`                                               |
| change a post's slug (URL)                | `rolepod_wp_post_update` with `slug` — heed `slug_changed_warning`      |
| add a 301 redirect (Rank Math backend)    | `rolepod_wp_redirect_set`                                               |
| read site setting                         | `rolepod_wp_option_get`                                                 |
| write site setting                        | `rolepod_wp_option_set` (production guard fires if siteurl-matched)     |
| arbitrary REST call                       | `rolepod_wp_rest_request`                                               |
| discover what routes exist                | `rolepod_wp_rest_dump`                                                  |
| read-only DB                              | `rolepod_wp_db_query`                                                   |

### 2. Gutenberg block markup for content fields

When `content` is a Gutenberg-block page, use the comment-syntax block markup:

```
<!-- wp:paragraph -->
<p>Hello world.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>Section title</h2>
<!-- /wp:heading -->
```

See `examples/content-examples.md` for non-trivial cases (group blocks, columns, cover, image with attributes).

### 3. Status flow

Default to `status=draft` on create. Promote to `publish` only with explicit user OK. Never set `publish` for the first commit of a major page (allows revision review).

### 4. Media + featured images

Upload with `rolepod_wp_media_upload(source: base64, data, filename, alt)` — or `source: url` for a remote image, or `source: local_path` for a file already on the server. **Always pass `alt`** (accessibility + SEO). To set a post's featured image in one step, add `rolepod_wp_media_upload(source: url, url, alt, set_featured: true, attach_to_post)`.

With the rolepod-wp companion (v2.23+) the upload is bounded server-side and recorded as a reversible ledger row (disable it to delete the attachment). Without the companion it falls back to a bare REST upload that is **not** ledgered — remove such an upload manually via `rolepod_wp_rest_request` DELETE on `/wp/v2/media/<id>?force=true`.

### 5. Terms, users, comments, CPTs (dual-path)

These four tools branch on target kind — **wp-cli** for shell targets (local/ssh/docker), **WP REST** for a RestTarget — so they work on every connection. The ledger records only on rest targets. Production writes need `confirm: true`.

- **Terms:** `rolepod_wp_term(action: ensure, taxonomy: category, name, slug)` is idempotent — it returns the existing term (`existed: true`) or creates it. `action: list` / `action: create` are also available. For a custom taxonomy whose REST base differs from its key, pass `rest_base`.
- **Users:** `rolepod_wp_user_write(action: create, username, email, role)` / `action: update` / `action: delete`. **A delete ALWAYS needs `reassign_to`** — the user id that inherits the deleted account's posts (Iron Rule #4).
- **Comments:** `rolepod_wp_comment(action: moderate, id, status)` where status is approve / hold / spam / trash; `action: delete` (add `force: true` to purge permanently instead of trashing); `action: list`.
- **Custom post types:** `rolepod_wp_cpt_scaffold(slug, singular, plural)` writes a small regular plugin that `register_post_type`s the CPT + flushes rewrite rules on activation, then activates it. Re-running for the same slug returns `CPT_ALREADY_EXISTS`. Multisite is unsupported.

### 6. Confirm + surface

State the operation, the `id` (post / user / option / attachment), and any warnings. If the response includes `_links`, just show the canonical link.

## If a matching Rolepod agent is available

- `rolepod:content-strategist` (audience: user) for copy quality.
- `rolepod:backend-developer` for non-trivial REST orchestration.

## If no matching agent is available

1. Pick the tool from the table.
2. For updates: read first, then update.
3. Default `status=draft`.
4. Surface the result.

## Output

No durable artifact — content lives in WordPress. The MCP returns IDs + canonical links.

## Examples

Read when constructing Gutenberg block markup or chaining multiple REST calls:

- `examples/content-examples.md` — good vs bad block markup; full landing-page composition example.

## References

Inline only. REST surface is documented at `https://developer.wordpress.org/rest-api/reference/`. Use `rolepod_wp_rest_dump` to discover the current site's actual routes.

## Hard stops

- `db_query` with non-SELECT → tool returns `DB_WRITE_BLOCKED`. STOP; re-route via REST or wp-cli (companion `/wp-cli` endpoint via `wp-execute-php`'s sibling pattern — but cleaner: use the right REST endpoint).
- `option_set` on production-matched siteurl without `confirm: true` → STOP. Ask user for explicit confirmation, then retry with `confirm: true`.
- `post_update` without `id` → STOP, ask the user which post.

## Full Rolepod enhancement

Full Rolepod adds bulk batching (run 20 post_create in one composite call with optimistic concurrency); standalone, batch by orchestrating individual calls.

## Next phase

- After publish → `wp-health-check` to verify the page is reachable.
- For a builder layout pass → `wp-edit-design`.
- For plugin-specific writes (Yoast meta, ACF fields) → `wp-edit-plugin`.
