# wp-changes — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — site broke after AI edited 12 things in the last hour

### Bad

```text
User: "เว็บพังหลังให้ AI แก้ของ"
Lead: rolepod_wp_changes_panic { since_minutes: 1440 }
  → disables 200 changes from the last 24 hours.

Result: site recovers BUT also reverts every legitimate publish from yesterday's
content batch. User furious.
```

Issues: panic window too wide; reverted unrelated work.

### Good

```text
User: "เว็บพังหลังให้ AI แก้ของเมื่อกี้"

Lead:
1. wp-health-check { target_id } → confirms red.

2. rolepod_wp_changes_query { target_id, since_minutes: 60, applied: true }
   → 12 rows, all from the last hour.
   List shown to user:
     #45 hook    woocommerce_after_single_product_summary    wp_scaffold (5 min ago)
     #46 file    wp-content/plugins/x/inc/hello.php          wp_file_write (5 min ago)
     #47 option  woocommerce_default_country                  wp_option_set (8 min ago)
     ...

3. Lead: "12 changes in the last 60 min. Going to panic-revert all 12, then
   bisect to find which one broke things. OK?"

4. User: "yes"

5. rolepod_wp_changes_panic { target_id, since_minutes: 60 }
   → disables 12 rows.

6. wp-health-check → green. Site recovered.

7. Bisect:
   a. toggle_bulk { ids: [45,46,47,48,49,50], applied: true } (first half)
      → wp-health-check → green. Bad row is in second half.
   b. toggle_bulk { ids: [51,52,53], applied: true } (first quarter of remaining)
      → wp-health-check → red. Bad row in {51,52,53}.
   c. toggle { id: 53, applied: false } (back to off)
      → wp-health-check → green. Bad row = either 51 or 52.
   d. toggle { id: 51, applied: false } (back to off)
      → wp-health-check → red still. Bad row = 52.
   e. Re-enable 53 + 51, leave 52 off.

8. Surface: "Bad change identified: row #52 — execute_php call that injected
   a fatal-error PHP. Left disabled. Re-enabled the other 11."

9. Hand off: wp-diagnose to understand why the execute_php payload broke things.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Window scope | 24h (too wide) | 60 min (matches user "เมื่อกี้") |
| User informed before action | no | yes (list + confirm) |
| Bisect to single row | no | yes |
| Legitimate work preserved | no (reverted yesterday's batch) | yes (other 11 re-enabled) |
| Root-cause handoff | none | wp-diagnose |

## Scenario 2 — single-row revert without bisect

### Bad

```text
User: "Undo the option change I made via AI ที่ปรับ blogname เมื่อกี้"
Lead: rolepod_wp_changes_panic { since_minutes: 10 }
  → disables 5 unrelated changes too.
```

Issues: panic for single revert. Too aggressive.

### Good

```text
User: "Undo only the blogname change AI ทำเมื่อกี้"

Lead:
1. rolepod_wp_changes_query {
     target_id, category: "option", since_minutes: 30, applied: true
   }
   → 2 option rows: #71 blogname, #72 timezone_string.

2. Lead: "found #71: blogname (was 'Old Name', now 'New Name'). Toggle off?"

3. User: "yes"

4. rolepod_wp_changes_toggle { target_id, id: 71, applied: false }
   → side_effect: { ok: true, category: "option", action: "reverted",
                    detail: "blogname" }

5. Surface: "Reverted. blogname now 'Old Name' again. #72 unchanged."

6. (Optional: verify)
   rolepod_wp_option_get { name: "blogname" } → "Old Name". ✓
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Scope | panic (5 rows) | single toggle (1 row) |
| Side effects | 4 unrelated reverts | none |
| Verification | none | option_get read-back |
| User mental model | "AI revert ทุกอย่าง" | "AI revert แค่ที่ขอ" |
