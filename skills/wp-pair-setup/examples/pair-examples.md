# wp-pair-setup — examples

Read the whole file — the contrast is the lesson.

## Scenario 1 — fresh redemption, token valid

### Bad

```text
User: "เชื่อม walnutztudio.com"
Lead: calls rolepod_wp_connect_rest { url: "https://walnutztudio.com" }
Lead: gets CREDENTIALS_MISSING
Lead: gives up + asks user to "create an App Password manually"
```

### Good

```text
User pastes:
=== rolepod-wplab one-click pair ===
Site URL: https://walnutztudio.com
Pair token (single-use, expires in 60 min): rolepod_wp_pair_8f3a...
...

Lead:
1. extracts siteurl + token
2. calls rolepod_wp_pair { siteurl: "https://walnutztudio.com",
                          pair_token: "rolepod_wp_pair_8f3a..." }
3. response: target_id=tgt_abc, companion_version=2.1.0, capabilities=[...]
4. calls rolepod_wp_health_check { target_id: "tgt_abc" }
5. response: companion_ok=true
6. tells user: "paired walnutztudio.com — target_id=tgt_abc, companion v2.1,
   is_production=false. ตอนนี้ทำอะไรต่อ?"
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Token redeemed | no — fell back manual | yes, via /pair/redeem |
| Credential stored | no — user typing | yes, in keychain |
| Companion verified | no | yes, via health_check |
| User effort | high (App Password dance) | one paste |

## Scenario 2 — token expired (>60 min after generation)

### Bad

```text
Lead: redeems token, gets HTTP 410 PAIR_TOKEN_EXPIRED
Lead: retries the same token — gets 410 again
Lead: retries a third time
```

Per-IP throttle: 10 failed redeems / hour → next retry returns 429 + the user is now rate-limited for an hour.

### Good

```text
Lead: redeems token, gets 410 PAIR_TOKEN_EXPIRED
Lead: STOPS retrying immediately.
Lead: tells user: "the pair_token expired (60 min TTL). Please regenerate
      one at https://walnutztudio.com/wp-admin/tools.php?page=rolepod-wp-setup
      and paste the new prompt."
```

### Why good wins

| Axis | Bad | Good |
|---|---|---|
| Retried expired token | yes, 3× | no, 0× |
| Rate-limit burned | yes — locked out 1h | no |
| User unblocked | no | yes, with deep link |
