---
name: wp-full
description: Alias / pointer skill — when the user wants "the full rolepod-wplab WP workflow", this lists every individual skill and the phase it belongs to. Zero supporting files. Phase = alias.
when_to_use: a user types `/wp-full` literally, OR asks for the complete WP skill set, OR wants a directory of every wp-* skill in the project
tier: 1
phase: alias
mode:
  standalone:
    role: tour of wplab tools + suggested in-domain workflow
    output: capability overview + recommended next skill
  with-rolepod:
    role: tool loader (no flow narrative)
    caller: rolepod:using-rolepod
    output: tool inventory only — parent owns flow
---

## Mode selection

If `$ROLEPOD_PARENT` is set to `1`, follow the **with-rolepod** mode — emit the
flat tool inventory under the "When with-rolepod" section below; do NOT render
the flow narrative. Parent's `using-rolepod` router decides which wplab skill
to invoke based on phase.

If `$ROLEPOD_PARENT` is unset, follow **standalone** mode — render the full
tour with phase grouping + recommended next skill, under the "When standalone"
section.

```bash
if [ "${ROLEPOD_PARENT:-}" = "1" ]; then MODE=with-rolepod; else MODE=standalone; fi
```

# WP Full

Pointer skill. Owns nothing. Has nothing under it. Exists so a single invocation surfaces the entire wp-* skill map.

## When with-rolepod

Parent detected. Print the flat tool inventory (no flow narrative):

```
wplab tools available:
- wp-diagnose      (debug evidence)
- wp-health-check  (verify evidence)
- wp-changes       (review evidence)
- wp-edit-design   (build primitive)
- wp-edit-plugin   (build primitive)
- wp-edit-theme    (build primitive)
- wp-scaffold      (build primitive)
- wp-migrate       (build + verify pair)
- wp-connect       (utility — opens a Target)
- wp-pair-setup    (utility — one-click pair via companion)
- wp-introspect    (utility — runtime introspection)
- wp-execute-php   (utility — guarded PHP eval)
- wp-content       (utility — core REST CRUD)
- wp-full          (this skill — already loaded)
```

Then stop. Parent owns the phase decision.

## When standalone

The 13 skills, by phase:

## Define

- **`wp-pair-setup`** — redeem a companion pair_token, mint App Password, open first Target.
- **`wp-connect`** — open Target on any kind (local / rest / ssh / docker) using vault credentials.

## Verify

- **`wp-health-check`** — sub-5s ping: versions, db_ok, rest_ok, companion_ok, warnings.

## Build

- **`wp-content`** — core REST CRUD: posts, pages, users, options, db SELECT, rest_request.
- **`wp-edit-design`** — Elementor / Divi / Oxygen / Bricks page-builder layouts.
- **`wp-edit-theme`** — theme files, theme.json, global-styles, child themes, theme switch (with snapshot + auto-rollback).
- **`wp-edit-plugin`** — Yoast / RankMath / WPML / WooCommerce / ACF / Forms read+write.
- **`wp-scaffold`** — bootstrap new block / plugin / theme / pattern.

## Debug

- **`wp-introspect`** — read-only runtime snapshot (hooks, transients, options, request_state, hook_state).
- **`wp-diagnose`** — multi-probe sweep + audit + ranked report.

## Ship

- **`wp-migrate`** — dryrun, apply, backup, restore, clone between targets.

## Recovery

- **`wp-changes`** — AI Change Ledger query + toggle + panic-revert + bisect.

## Power

- **`wp-execute-php`** — last-resort PHP eval with 5-layer safety chain.

## Reading order

Onboarding a new site → `wp-pair-setup` → `wp-health-check` → the build skill matching user intent.
Debugging an existing site → `wp-health-check` → `wp-diagnose` → `wp-introspect` → fix via the right edit skill.
Shipping work between sites → `wp-migrate`.

## No supporting files

This is an alias. Zero `templates/`, `examples/`, `references/`. The 11 individual skills carry the depth.
