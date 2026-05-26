# wp-execute-php — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — set a transient programmatically

### Bad

```text
Lead, prompted "set a transient":
  execute_php {
    payload: 'eval("set_transient(\'foo\', \'bar\', 3600);"); return \'ok\';',
    confirm: true
  }
```

Issues: payload uses `eval` to wrap a normal WP call. AST screen rejects with `AST_REJECTED token=eval`. Even if it passed, the inner call could have been the payload directly.

### Good

```text
Lead, prompted "set a transient":

  1. Justify: "transient is not exposed in core REST; closest skill is
     execute-php with a 1-line WP API call."

  2. Pre-screen mentally: payload uses only `set_transient` (allowed).

  3. Confirm prereqs:
     - ROLEPOD_WPLAB_PROFILE=power → present
     - target is dev.walnut.local, not production-matched → safe
     - confirm:true → user said "yes"

  4. Call:
     execute_php {
       target_id,
       payload: "set_transient('my_feature_cache', ['ts' => time(), 'v' => 'hello'], 3600);
                 return get_transient('my_feature_cache');",
       confirm: true,
       timeout_ms: 5000
     }

  5. Response:
     - return_value: { ts: 1716750000, v: "hello" }
     - php_warnings: []
     - duration_ms: 12
     - audit_id: rolepod_wp_audit_e3f4a2c1

  6. Surface: "transient set; verified via get_transient; audit_id e3f4..."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Used eval | yes (blocked) | no |
| AST screen passes | no | yes |
| Justified power tool | no | yes (one sentence) |
| Verified result | no | yes (read-after-write in same call) |
| Audit_id surfaced | n/a | yes |

## Scenario 2 — instantiate a class for debugging

### Bad

```text
Lead, prompted "what is the total on WC_Order 123":
  execute_php {
    payload: 'system("wp eval-php \'return (new WC_Order(123))->get_total();\'");',
    confirm: true
  }
```

Issues: `system` blocked. Even worse: trying to shell out to wp-cli FROM inside execute-php, which is double-indirection that the wp_cli_run companion endpoint already does cleanly.

### Good

```text
Lead, prompted "what is the total on WC_Order 123":

  1. Justify: "WC_Order method access is internal API, not REST-exposed cleanly
     for arbitrary fields. wp-cli could do `wp wc order get 123` but execute-php
     is more direct for one-shot debugging."

  2. Pre-screen: only `new WC_Order` + `->get_total()` — no blocked tokens.

  3. Confirm prereqs.

  4. Call:
     execute_php {
       target_id,
       payload: "if (!class_exists('WC_Order')) { return ['error' => 'WooCommerce not loaded']; }
                 $order = new WC_Order(123);
                 if (!$order->get_id()) { return ['error' => 'order 123 not found']; }
                 return [
                   'id'    => $order->get_id(),
                   'total' => $order->get_total(),
                   'status'=> $order->get_status(),
                 ];",
       confirm: true,
       timeout_ms: 5000
     }

  5. Response:
     - return_value: { id: 123, total: "199.00", status: "processing" }
     - audit_id: rolepod_wp_audit_8b9c1d20

  6. Surface verbatim.
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Used system | yes (blocked) | no |
| Double-indirected via wp-cli | yes | no |
| Guarded against missing class | no | yes (`class_exists`) |
| Guarded against missing order | no | yes (`get_id()` check) |
| Output structured | one string | typed dict |
