---
name: wp-connect
description: Open a WordPress Target on any kind (local / REST + App Password / SSH / Docker) using credentials already in the vault. Phase = Define.
when_to_use: a user asks to work on a site whose credentials are already paired/stored, OR explicitly wants a non-REST connection kind (local path, SSH, Docker container)
tier: 1
phase: define
---

# WP Connect

Re-open a previously paired site, or open a new connection over local/SSH/Docker. Picks the right `connect_*` tool by what the user has and what they need to do.

## Iron Rule

<EXTREMELY-IMPORTANT>
1. NEVER pick a connection kind without knowing what the user will DO — REST covers almost everything, but Local/SSH/Docker are needed for direct filesystem work outside ABSPATH, and for wp-cli when the companion is not installed (a RestTarget without it raises COMPANION_REQUIRED_V0_2).
2. NEVER store the chosen kind silently — surface "I'm opening this as a `<kind>` target because <reason>" so the user can correct mid-flow.
3. ALWAYS close the previous target with `rolepod_wp_disconnect` before opening the same site under a different kind — registry collisions cause confusing tool failures later.
</EXTREMELY-IMPORTANT>

## When to use

- "เชื่อม walnutztudio.com" + creds are already in vault (skip pair).
- User wants to work against a local WordPress at `/path/to/wp/`.
- User has SSH access to the server and wants direct shell.
- User runs WP-in-Docker locally.

Skip when:
- No creds in vault AND user pasted a pair prompt → `wp-pair-setup`.
- User already has an active target_id → no need to reconnect.

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
- Picking the kind (local / rest / ssh / docker).
- Calling the right `rolepod_wp_connect_<kind>` tool.
- Surfacing the resulting `target_id` + companion status.

Does not own:
- Pairing (first-time companion redeem) → `wp-pair-setup`.
- Post-connect health probe — that is `wp-health-check`.
- Any actual WP operation — pick the right next skill.

Return / hand off:
- REST + no creds → `wp-pair-setup` (plugin-first walkthrough). Manual App Password entry is the last resort inside that flow, never the opening offer.
- Connection opens but companion missing → `wp-health-check` for full report.

## Inputs to gather

- siteurl (REST) OR filesystem path (Local) OR `host:user` (SSH) OR `container_name` (Docker).
- For SSH: SSH key path / port if non-default.
- For Docker: container name / wp-cli command path inside container.
- (optional) `require_companion: true` if the user explicitly needs power tools.

## Workflow

### 1. Pick the kind

Read `references/connect-kinds.md` if unsure. Quick rule:

| User has | Pick |
|---|---|
| siteurl + App Password (any host, including shared) | `rest` |
| filesystem path to wp-config.php | `local` |
| SSH access to server | `ssh` |
| WP in Docker on this machine | `docker` |

Default to REST unless the user explicitly says otherwise — it works on every host.

### 2. Open

Call the matching tool:
- `rolepod_wp_connect_rest { url, [credential_ref], [require_companion] }`
- `rolepod_wp_connect_local { path }`
- `rolepod_wp_connect_ssh { host, user, [keyPath], [port] }`
- `rolepod_wp_connect_docker { containerName, [wpCliPath] }`

### 3. Surface state

Tell user: kind + target_id + wp_version + companion presence + any warnings.

### 4. Hand off

If user already said what to do → hand off immediately. Otherwise ask.

## If a matching Rolepod agent is available

- `rolepod:devops-sre` for SSH key / Docker config issues.
- `rolepod:backend-developer` for follow-up REST work.

## If no matching agent is available

Execute as Lead:
1. Read what the user has.
2. Pick a kind (REST is default).
3. Call the right `connect_*`.
4. Surface target_id + warnings.
5. Hand off.

## Output

No durable artifact. The opened target lives in the in-memory `TargetRegistry` for this session.

## Examples

No examples file. Kind selection is single-decision and the workflow is one tool call.

## References

Load when the user's situation does not match the quick rule:
- `references/connect-kinds.md` — which kind for which scenario; trade-offs around companion availability, security guarantees, and performance.

## Hard stops

- `CREDENTIALS_MISSING` on REST → STOP. Hand off to `wp-pair-setup` — it walks the user through installing the plugin and pairing. Suggest manual `rolepod-wplab credentials add <site>` only as the last resort (plugin uninstallable, or the user declined it).
- `REST_AUTH_FAILED` on a previously-working site → STOP. The App Password was revoked from profile.php. Hand off to `wp-pair-setup`.
- `require_companion=true` but `companion: null` → STOP. Tell user to install the WP plugin via `wp plugin install https://github.com/nuttaruj/rolepod-wp/releases/latest/download/rolepod-wp.zip --activate`.
- HTTP, not HTTPS → STOP. RestTarget refuses non-https URLs unconditionally.

## Full Rolepod enhancement

Full Rolepod adds an auto-reconnect path that detects an expired session token mid-flow and silently re-handshakes; standalone, the user sees a single retryable error.

## Next phase

- `wp-health-check` for a fuller report after open.
- The skill matching the user's original ask (`wp-content`, `wp-edit-*`, `wp-scaffold`, `wp-diagnose`, `wp-execute-php`).
