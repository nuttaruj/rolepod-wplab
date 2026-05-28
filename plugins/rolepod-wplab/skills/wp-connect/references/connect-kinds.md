# Connection-kind selection

## Quick comparison

| Kind | Transport | Companion required | Filesystem | wp-cli native | Production-safe |
|---|---|---|---|---|---|
| `rest` | HTTPS + App Password | optional (recommended) | via companion `/fs-*` | via companion `/wp-cli` | ✓ |
| `local` | filesystem path | no | direct | direct | ✗ (dev only) |
| `ssh` | SSH | no | over SSH | over SSH | ✓ if hardened |
| `docker` | dockerode exec | no | over docker cp | over docker exec | ✗ (dev only) |

## When to pick which

### REST (default — pick this 95% of the time)

- Works on shared hosting (Hostinger, SiteGround, GoDaddy, etc.).
- No SSH access needed.
- Auth: App Password (per-user, revocable).
- Power tools unlock once `rolepod-wp` companion is installed + endpoints enabled.

Pick REST when:
- You only know the URL.
- The user does not host the site themselves.
- You want the safest transport for production.

### Local

- The site lives on this machine, you know the path to `wp-config.php`.
- Use for fast iteration during plugin/theme development.
- wp-cli runs directly (no companion needed for that).

Pick Local when:
- Path to wp install is given.
- User is developing the plugin/theme itself.
- Site is non-production.

### SSH

- Direct shell into the server.
- Bypasses both REST + companion entirely.
- Fastest for ops work (deploy, migrate, audit).

Pick SSH when:
- User gives `host`, `user`, key path.
- Companion install is impossible (locked-down host).
- Bulk filesystem ops (clone, backup) need direct access.

### Docker

- WP-in-Docker on this machine, container name given.
- Use for parity testing (matching CI environment).

Pick Docker when:
- Container name is given.
- User runs WordPress in a local Docker setup.

## Production safety per kind

The Node-side production guard (`ProductionGuard`) fires on:
- `siteurl` matching admin-configured glob patterns (e.g. `*.example.com`)
- Any host configured in companion settings under "Production hostnames"

It applies regardless of kind — but the kind affects WHAT can be done:

- REST + companion: execute-php refuses on prod-matched siteurl.
- Local + companion absent: no production-guard on local writes; the user is responsible.
- SSH: same as local (kind is determined by the connection, not the URL).
- Docker: dev environment by definition.

The MCP refuses HTTPS-bypass and demands TLS for REST. Local/SSH/Docker assume the operator already controls the transport.
