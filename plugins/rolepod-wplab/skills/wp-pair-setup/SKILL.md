---
name: wp-pair-setup
description: Redeem a `rolepod-wp` companion pair_token, mint a WP Application Password, and open the first Target — the canonical onboarding flow. Phase = Define.
when_to_use: a user pastes a pair prompt from Tools → Rolepod WP Setup, OR mentions a `rolepod_wp_pair_<hex>` token, OR asks "เชื่อม WordPress" without prior credentials in the vault
tier: 1
phase: define
---

# WP Pair Setup

Onboarding skill. The companion-issued pair_token is a single-use, 60-min, single-bind credential bridge. This skill redeems it once, persists the resulting App Password, opens a RestTarget, and confirms readiness — so the user can move into build/debug work without the manual App Password dance.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER call `rolepod_wp_pair` twice with the same `pair_token` — it is single-use; the second call returns 410 and burns the user's chance.
2. NEVER fall back to manual App Password entry without first checking `wp_health_check` after the pair — a half-paired target reads `companion: null` and silently breaks every companion-gated tool.
3. ALWAYS run `rolepod_wp_health_check` on the returned `target_id` before reporting "ready" — a 200 from `/pair/redeem` only proves the token redeemed, not that the site is workable.
</EXTREMELY-IMPORTANT>

## When to use

- User pasted a prompt that begins `=== rolepod-wplab one-click pair ===`.
- A token in the form `rolepod_wp_pair_<48 hex>` appears in chat.
- "เชื่อม walnutztudio.com" / "connect my WordPress" with no prior credentials in vault.

Skip when:
- Credentials for the site are already in the vault — use `wp-connect` instead.
- The user wants manual App Password entry — use `wp-connect` Path B.

## Session bootstrap (run once, right after connecting)

The connect tools return `prod_guard`. Read it before any write: `armed: false`
does not mean the target is safe, it means nobody told the server otherwise.

Then, in order:

1. `rolepod_wp_memory_recall(target_id)` — notes from earlier sessions on this
   site. Skip nothing here; this is where "the client hates the blue" lives.
2. `rolepod_wp_conventions_get(target_id)` — the project's own rules (naming,
   builder, deploy). Follow them over your defaults.
3. `rolepod_wp_skill_catalog(target_id)` — which workflow guides exist,
   including any the user wrote. `rolepod_wp_skill_get` reads one.

Record what you learn with `rolepod_wp_memory_note(target_id, ...)` before the
session ends, or the next session starts blind.

## Boundary

Owns:
- Single-use redemption of a `rolepod_wp_pair_<hex>` token.
- Persisting the minted credential into the local vault.
- First-connect handshake + health probe.

Does not own:
- Generating the token (companion-side, `wp-admin → Tools → Rolepod WP Setup`).
- Subsequent connects to the same site → `wp-connect`.
- Any write to WordPress content / config → the relevant edit skill.

Return / hand off:
- Token expired / single-use violation → tell user to regenerate from `Tools → Rolepod WP Setup`.
- Pair returned `companion_version` below `MIN_COMPANION_VERSION` → tell user to upgrade plugin from the stable URL.
- After health-check passes → hand off to `wp-content`, `wp-edit-design`, `wp-diagnose`, or whatever the user originally asked for.

## Inputs to gather

- `siteurl` — extracted from the prompt's `Site URL:` line.
- `pair_token` — the literal `rolepod_wp_pair_<48 hex>` string.
- (optional) target CLI for the install snippet (Claude Code / Cursor / Codex / Gemini).

## Workflow

### 1. Sanity-check the token

The token MUST start with `rolepod_wp_pair_` and be exactly 64 chars total. If not, the prompt is corrupted or pasted half — ask user to regenerate.

### 2. Redeem the token

Call `rolepod_wp_pair { siteurl, pair_token }`. Expect 200 with `target_id`, `companion_version`, `capabilities`, `app_password_name`, `is_production`, `credential_stored`.

If `credential_stored: false`, the vault write failed (permissions / disk full) — surface the warning. The Target still opens for this session but will not survive a restart.

### 3. Verify health on the returned target_id

Call `rolepod_wp_health_check { target_id }`. Required: `companion_ok: true`. If false, the redemption succeeded but the companion is unreachable on a subsequent request — usually a permalink or REST-routing config on the host. Surface the warnings array verbatim.

### 4. Confirm + hand off

State the siteurl, target_id, capabilities, and `is_production` flag back to the user, then ask what they want to do next (or do it if they already asked).

## If a matching Rolepod agent is available

Delegate to the closest specialist:
- `rolepod:backend-developer` for follow-up REST work
- `rolepod:devops-sre` for infra-side companion install issues

## If no matching agent is available

Execute as Lead with this minimum viable checklist:
1. Extract siteurl + pair_token from the prompt.
2. Call `rolepod_wp_pair`.
3. On 200 → call `rolepod_wp_health_check`.
4. Report target_id + capabilities + is_production.
5. Ask what to do next.

## Output

No durable artifact. The minted App Password lives in the OS keychain (or `~/.config/rolepod-wplab/credentials.json` on Linux/Win). The companion's audit log retains the redemption entry server-side.

## Examples

Non-blocking — read only when the redemption returns an unfamiliar error code:
- `examples/pair-examples.md` — good vs bad prompt parsing + recovery on expired token.

## References

Inline only. Endpoint: `POST /wp-json/wplab/v1/pair/redeem` body `{ pair_token }`. Response shape = `PairOutput` schema in `src/schema/tools.ts`.

## Hard stops

- Token starts with anything other than `rolepod_wp_pair_` → STOP, ask user to regenerate.
- `companion_version` below `MIN_COMPANION_VERSION` → STOP, tell user to upgrade via `wp plugin install https://github.com/nuttaruj/rolepod-wp/releases/latest/download/rolepod-wp.zip --activate`.
- Three failed redemptions on the same site → STOP, do not retry; user must regenerate the token (per-IP throttle = 10 failed / hour).

## Full Rolepod enhancement

Full Rolepod adds a phase router that auto-routes to `wp-connect` on subsequent calls to the same site (no re-pair needed) and to `wp-diagnose` if the post-pair health check returns warnings.

## Next phase

- Post-pair, hand off to the skill matching the user's original ask (`wp-content`, `wp-edit-design`, `wp-edit-plugin`, `wp-scaffold`, `wp-diagnose`, or `wp-execute-php`).
- If user did not state intent, default to `wp-health-check` for a fuller report.
