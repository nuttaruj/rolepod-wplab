---
name: wp-audit-woo
description: Audit WooCommerce config — products, settings, shipping zones, payment gateways. Read-only.
---

## When to use

- Pre-launch checklist for a WooCommerce shop.
- After installing/configuring a new payment or shipping plugin.
- Before merging a WooCommerce-touching change.

## When NOT to use

- Deep transaction debugging (use WP debug + `/wp-introspect` for runtime state).
- Non-WooCommerce site (tool returns `detected: false` quickly).

## Inputs

- `target_id`.
- Optional: `include_recent_orders` — default 0 (privacy default).

## Outputs

- Findings consolidated from multiple `rolepod_wp_woo_read` calls per scope: settings_groups, shipping_zones, payment_gateways.

## Process

1. Detect WooCommerce active via `rolepod_wp_woo_read { scope: settings_groups }`.
2. Loop scopes: shipping_zones, payment_gateways, settings_groups.
3. Synthesize findings into a brief report. Highlight: zero shipping zones, no active payment gateway, tax not configured.

## If the tool is unavailable

WooCommerce not active on this target. Skip the audit.

## Examples

```
User: "audit WooCommerce on staging"
Lead → rolepod_wp_woo_read { target_id, scope: "settings_groups" }
     → rolepod_wp_woo_read { target_id, scope: "shipping_zones" }
     → rolepod_wp_woo_read { target_id, scope: "payment_gateways" }
Lead reply: "✓ tax configured, ✓ 2 shipping zones, ⚠ only Stripe enabled (no fallback)"
```
