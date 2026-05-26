---
name: wp-full
description: Alias / pointer skill — when the user wants "the full rolepod-wplab WP workflow", this lists every individual skill and the phase it belongs to. Zero supporting files. Phase = alias.
when_to_use: a user types `/wp-full` literally, OR asks for the complete WP skill set, OR wants a directory of every wp-* skill in the project
tier: 1
phase: alias
---

# WP Full

Pointer skill. Owns nothing. Has nothing under it. Exists so a single invocation surfaces the entire wp-* skill map.

The 11 skills, by phase:

## Define

- **`wp-pair-setup`** — redeem a companion pair_token, mint App Password, open first Target.
- **`wp-connect`** — open Target on any kind (local / rest / ssh / docker) using vault credentials.

## Verify

- **`wp-health-check`** — sub-5s ping: versions, db_ok, rest_ok, companion_ok, warnings.

## Build

- **`wp-content`** — core REST CRUD: posts, pages, users, options, db SELECT, rest_request.
- **`wp-edit-design`** — Elementor / Divi / Oxygen / Bricks layouts + theme.json + global-styles.
- **`wp-edit-plugin`** — Yoast / RankMath / WPML / WooCommerce / ACF / Forms read+write.
- **`wp-scaffold`** — bootstrap new block / plugin / theme / pattern.

## Debug

- **`wp-introspect`** — read-only runtime snapshot (hooks, transients, options, request_state, hook_state).
- **`wp-diagnose`** — multi-probe sweep + audit + ranked report.

## Ship

- **`wp-migrate`** — dryrun, apply, backup, restore, clone between targets.

## Power

- **`wp-execute-php`** — last-resort PHP eval with 5-layer safety chain.

## Reading order

Onboarding a new site → `wp-pair-setup` → `wp-health-check` → the build skill matching user intent.
Debugging an existing site → `wp-health-check` → `wp-diagnose` → `wp-introspect` → fix via the right edit skill.
Shipping work between sites → `wp-migrate`.

## No supporting files

This is an alias. Zero `templates/`, `examples/`, `references/`. The 11 individual skills carry the depth.
