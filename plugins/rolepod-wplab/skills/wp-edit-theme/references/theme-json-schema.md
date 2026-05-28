# theme.json schema — quick reference

WordPress block-theme config. Lives at `wp-content/themes/<slug>/theme.json`. The Site Editor lets users layer their own values ON TOP via global-styles; the theme.json file is the BASE.

## Top-level keys

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": { ... },
  "styles": { ... },
  "customTemplates": [ ... ],
  "templateParts": [ ... ],
  "patterns": [ "..." ]
}
```

## settings (theme capabilities)

```json
"settings": {
  "appearanceTools": true,    // master toggle for borders + dimensions etc.
  "color": {
    "palette": [
      { "slug": "primary", "name": "Primary", "color": "#1a73e8" },
      { "slug": "ink",     "name": "Ink",     "color": "#0a0a0a" }
    ],
    "gradients": [...],
    "duotone": [...],
    "custom": true
  },
  "typography": {
    "fontFamilies": [
      { "slug": "system", "name": "System", "fontFamily": "system-ui, sans-serif" }
    ],
    "fontSizes": [
      { "slug": "sm", "size": "0.875rem" },
      { "slug": "md", "size": "1rem" }
    ],
    "lineHeight": true,
    "letterSpacing": true
  },
  "spacing": {
    "spacingScale": { "steps": 7 },
    "spacingSizes": [...],
    "units": ["px","em","rem","vh","vw","%"]
  },
  "layout": {
    "contentSize": "720px",
    "wideSize": "1200px"
  }
}
```

## styles (apply settings)

Reference preset values via `var:preset|<category>|<slug>`:

```json
"styles": {
  "color": {
    "background": "var:preset|color|ink",
    "text": "var:preset|color|primary"
  },
  "typography": {
    "fontFamily": "var:preset|font-family|system",
    "fontSize": "var:preset|font-size|md"
  },
  "spacing": {
    "blockGap": "var:preset|spacing|40"
  },
  "elements": {
    "h1": { "typography": { "fontSize": "var:preset|font-size|xl" } },
    "button": { "color": { "background": "var:preset|color|primary" } }
  }
}
```

## Common pitfalls

1. **Slug uniqueness within a category** — two color palette entries with the same `slug` = the second silently wins. Edit always reads first, append by slug.
2. **`var:preset|...` typos** — wrong category (`color` vs `colors`) silently emits no CSS, color falls back to default. The editor shows nothing wrong; user sees the wrong color.
3. **Schema version drift** — WP keeps bumping `"version"` (currently 3). Old `version: 2` files still work but miss new keys (dimensions, position, shadow). Bump version when adopting newer keys.
4. **`appearanceTools: true` is global** — turns on borders + dimensions + position + shadow for EVERY block. Cannot be scoped per-block; refuse or accept whole-site.
5. **Custom property naming** — `settings.custom.foo.bar` emits `--wp--custom--foo--bar`. Underscores collapse to single dashes; case is preserved. Plan property names accordingly.
6. **User-global-styles layers on top** — values set in Site Editor (`/wp/v2/global-styles/<id>`) override theme.json. Editing theme.json alone may leave user values winning. Either read + reconcile, or hit the global-styles REST endpoint instead.

## Validation gate

The MCP runs `JSON.parse` client-side before sending to `file_write`. Bad JSON = immediate rejection with line number. After write, the companion auto-flushes object cache so the Site Editor sees the new state on next reload.

## Common patches

### Change palette only

```json
{
  ...existing theme.json keys preserved...,
  "settings": {
    ...existing settings preserved...,
    "color": {
      "palette": [
        { "slug": "primary", "name": "Primary", "color": "#NEW_HEX" },
        ...rest of existing palette
      ]
    }
  }
}
```

Pattern: deep-merge into the existing structure rather than replace.

### Add a custom font

1. Upload TTF/WOFF2 to `wp-content/themes/<slug>/assets/fonts/`.
2. In theme.json:

```json
"settings": {
  "typography": {
    "fontFamilies": [
      {
        "slug": "brand",
        "name": "Brand Sans",
        "fontFamily": "'Brand Sans', system-ui, sans-serif",
        "fontFace": [
          {
            "fontFamily": "Brand Sans",
            "fontWeight": "400",
            "fontStyle": "normal",
            "src": ["file:./assets/fonts/brand-sans-400.woff2"]
          }
        ]
      }
    ]
  }
}
```

3. Reference: `"fontFamily": "var:preset|font-family|brand"`.

### Add a spacing preset

```json
"settings": {
  "spacing": {
    "spacingSizes": [
      { "slug": "20", "size": "0.5rem",  "name": "X-Small" },
      { "slug": "30", "size": "1rem",    "name": "Small" },
      { "slug": "40", "size": "1.5rem",  "name": "Medium" }
    ]
  }
}
```
