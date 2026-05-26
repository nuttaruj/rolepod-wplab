# wp-content — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — Gutenberg block markup for a multi-section landing page

### Bad

```text
post_create {
  type: "page",
  title: "Landing",
  content: "Welcome! This is our landing page. Click here for more."
}
```

Result: a page rendered as a single classic paragraph. Theme-editor + block-inserter unusable on it.

### Good

```text
post_create {
  type: "page",
  title: "Launch",
  status: "draft",
  content: '<!-- wp:cover {"url":"/wp-content/uploads/hero.jpg","dimRatio":40} -->
<div class="wp-block-cover">
  <span aria-hidden="true" class="wp-block-cover__background has-background-dim" style="background-color:#000"></span>
  <div class="wp-block-cover__inner-container">
    <!-- wp:heading {"level":1,"textAlign":"center"} -->
    <h1 class="has-text-align-center">Ship faster with Rolepod</h1>
    <!-- /wp:heading -->
  </div>
</div>
<!-- /wp:cover -->

<!-- wp:columns -->
<div class="wp-block-columns">
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:heading {"level":2} --><h2>Feature A</h2><!-- /wp:heading -->
    <!-- wp:paragraph --><p>One-paragraph pitch.</p><!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
  <!-- wp:column -->
  <div class="wp-block-column">
    <!-- wp:heading {"level":2} --><h2>Feature B</h2><!-- /wp:heading -->
    <!-- wp:paragraph --><p>One-paragraph pitch.</p><!-- /wp:paragraph -->
  </div>
  <!-- /wp:column -->
</div>
<!-- /wp:columns -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons">
  <!-- wp:button -->
  <div class="wp-block-button"><a class="wp-block-button__link" href="/signup">Get started</a></div>
  <!-- /wp:button -->
</div>
<!-- /wp:buttons -->'
}
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Block-editor compatible | no — locked as classic | yes — every section editable in block inserter |
| Theme-aware rendering | no | yes — uses theme.json colors + spacing |
| Status default | (publish, undocumented) | draft, explicit |
| Future-edit cost | high (re-parse classic HTML) | low (block tree) |

## Scenario 2 — update the site title, production target

### Bad

```text
option_set { target_id, name: "blogname", value: "New Name" }
```

If `siteurl` matches a production hostname configured in the companion, the production guard fires → returns `PRODUCTION_BLOCKED`. The user then runs the call again with `confirm: true` and pushes through accidentally.

### Good

```text
1. Read first:
   option_get { target_id, name: "blogname" }
   → "WordPress site"

2. Confirm intent with user:
   "Current blogname = 'WordPress site'. Change to 'New Name'?
    This site is production-matched (siteurl in production hosts).
    Reply 'yes, confirm' to proceed."

3. User: "yes, confirm"

4. Write with confirm:
   option_set { target_id, name: "blogname", value: "New Name", confirm: true }
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Read-before-write | no | yes — current value displayed |
| User shown prod warning | no | yes — explicit |
| Confirm flag rationale | hidden | tied to user reply |
| Rollback knowable | no | yes — old value recorded |
