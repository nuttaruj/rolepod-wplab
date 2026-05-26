# Template hierarchy — block themes (v6.0+)

When a request hits WP, it walks the template hierarchy to find which template renders. For block themes, templates live as `.html` files under `<theme>/templates/` and `<theme>/parts/`.

## Hierarchy walk order (front-end)

```
Request URL → resolved template (first match wins)

/                       → home.html → index.html
/?page_id=N             → page-<slug>.html → page-<id>.html → page.html → singular.html → index.html
/?p=N (single post)     → single-<post_type>-<slug>.html → single-<post_type>.html → single.html → singular.html → index.html
/category/<slug>/       → category-<slug>.html → category-<id>.html → category.html → archive.html → index.html
/author/<slug>/         → author-<nicename>.html → author-<id>.html → author.html → archive.html → index.html
/tag/<slug>/            → tag-<slug>.html → tag-<id>.html → tag.html → archive.html → index.html
/<year>/<month>/        → date.html → archive.html → index.html
/?s=query (search)      → search.html → index.html
404                     → 404.html → index.html
```

## Parts (reusable across templates)

```
parts/
  header.html
  footer.html
  navigation.html (post type: wp_navigation usually)
  sidebar.html
  comments.html
```

Reference via block markup inside a template:
```html
<!-- wp:template-part {"slug":"header","theme":"<slug>"} /-->
```

## When to override

| User intent | Edit |
|---|---|
| Change site header | `parts/header.html` |
| Change a single post layout | `templates/single.html` |
| Change Woo product page | `templates/single-product.html` (Woo registers it) |
| Change category archive | `templates/category.html` |
| Add a custom template option in Site Editor | `templates/<name>.html` + theme.json `customTemplates` entry |

## customTemplates registration

In theme.json:

```json
"customTemplates": [
  {
    "name": "blank",
    "title": "Blank canvas",
    "postTypes": ["page", "post"]
  }
]
```

Plus the file at `templates/blank.html`. The Site Editor "Template" dropdown will list "Blank canvas" for users to apply.

## Common pitfalls

1. **Block markup must be valid HTML+comment syntax** — a missing `/-->` breaks parsing; the template renders empty + the editor shows a "block validation failed" error. Always render-check after edit.
2. **`theme` attribute must match the active stylesheet** — `<!-- wp:template-part {"slug":"header","theme":"twentytwentyfive"} /-->` breaks if theme switched. Use `tagName` + slug only when possible; the theme attribute auto-resolves.
3. **Caching** — block templates are aggressively cached in object cache. After edit, hit `wp_cache_tool` flush_object. (Our file_write does NOT auto-flush for template files — only for theme.json. Trigger manually for HTML edits.)
4. **Patterns from theme.json `"patterns"` array** — listed slugs are pulled from WordPress.org pattern directory, not local. To register a LOCAL pattern, drop the file in `patterns/<slug>.php` (WP auto-registers via header parsing).

## Child theme override

If you have a child theme active and want to override a parent template:

1. Copy the parent template into the child's `templates/` dir (same filename).
2. Edit the child copy.
3. WP loads the child version first; parent untouched.

Same for parts: copy `parts/header.html` from parent to child.

## When to use Site Editor REST instead of file_write

| Use case | Choose |
|---|---|
| Edit the template once, ship to all users of the theme | file_write the .html |
| User wants to customize per-site (visual editor) | `/wp/v2/templates/<id>` via rest_request — saves under wp_posts, not the file |
| Reset to theme default | `DELETE /wp/v2/templates/<id>` removes the user override, theme file takes over |
