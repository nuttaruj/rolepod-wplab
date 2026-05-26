# wp-edit-design — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — add a 3-column features section in Elementor

### Bad

```text
elementor_write {
  target_id, page_id: 42,
  tree: [
    { "elType": "Section", "settings": {} ,
      "elements": [
        { "elType": "Column", "elements": [
          { "elType": "Widget", "widgetType": "Heading", "settings": { "title": "F1" } }
        ] }
      ]
    }
  ],
  backup: false
}
```

Issues: `elType` PascalCased (must be lowercase), `widgetType` PascalCased (must be `heading`), no IDs (adapter would assign, but mixed-case fails first), `backup: false` removes the safety net.

### Good

```text
1. Read current tree:
   elementor_read { target_id, page_id: 42 }
   → has a hero section + a CTA section.

2. Plan with user:
   "I will insert a 3-column features section between the hero (id=a1b2c3d4)
    and the CTA (id=e5f6g7h8). Each column has a heading + paragraph + icon.
    Confirm?"

3. User: "yes"

4. Write:
   elementor_write {
     target_id, page_id: 42,
     tree: [
       { ...hero unchanged... },
       {
         "id": "newsec01",
         "elType": "section",
         "settings": { "structure": "33" },
         "elements": [
           { "id": "newcol01", "elType": "column",
             "settings": { "_column_size": 33 },
             "elements": [
               { "id": "newwid01", "elType": "widget", "widgetType": "heading",
                 "settings": { "title": "Fast", "size": "h3" } },
               { "id": "newwid02", "elType": "widget", "widgetType": "text-editor",
                 "settings": { "editor": "<p>One-paragraph pitch.</p>" } }
             ]
           },
           ...col 2, col 3...
         ]
       },
       { ...cta unchanged... }
     ],
     backup: true
   }

5. Adapter writes `_elementor_data_wplab_backup` with the prior tree.
6. wp-health-check → REST OK.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Case correctness | wrong (PascalCase) | right (lowercase) |
| Read before write | no | yes (preserves untouched sections) |
| User approved | no | yes (diff described first) |
| Backup | OFF | ON (rollback possible) |
| Hero+CTA preserved | likely overwritten | yes |

## Scenario 2 — change theme.json color palette

### Bad

```text
file_write { target_id,
  path: "wp-content/themes/twentytwentyfive/theme.json",
  content: "{...new full theme.json...}"
}
```

Issues: complete-replace overwrites everything (typography, layout, spacing). One typo = Site Editor breaks.

### Good

```text
1. Read current theme.json:
   file_read { target_id,
     path: "wp-content/themes/twentytwentyfive/theme.json" }
   → 1.5 KB JSON; record current settings.color.palette.

2. Patch ONLY the palette in memory (not full replace).
   Validate the patched JSON parses (json.loads server-side equivalent).

3. Show user the diff:
   "Old palette: [#000, #fff, #888, #f0f]
    New palette: [#1a1a1a, #ffffff, #e0e0e0, #ff6b6b]
    Other 28 keys unchanged. OK?"

4. User: "yes"

5. Write:
   file_write {
     target_id,
     path: "wp-content/themes/twentytwentyfive/theme.json",
     content: <patched JSON>,
     backup: true
   }
   → creates `.wplab-bak-YYYYMMDD-HHMMSS` next to theme.json.

6. After write, hit /wp/v2/global-styles to confirm new palette resolves.
   wp-health-check → REST OK.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Patch scope | whole file | only palette key |
| JSON pre-validated | no | yes (server-equivalent parse before write) |
| Backup | only if backup:true default | yes |
| Diff shown to user | no | yes |
| Rollback path | file_write old content | restore from `.wplab-bak-...` |
