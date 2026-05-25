# tests/fixtures — local WordPress for wplab dogfood

A docker-compose'd WordPress install that the maintainer can point `rolepod-wplab` at.

## Topology

| Service | Image | Host binding | Notes |
|---|---|---|---|
| `db` | `mariadb:11` | `127.0.0.1:3307` | named volume `db_data` |
| `wordpress` | `wordpress:6.6-php8.3-apache` | `127.0.0.1:8989` | bind-mounts `./wp-data/` |

The same `wp-config.php` works from inside the WP container AND from host wp-cli, because `DB_HOST = host.docker.internal:3307` resolves correctly in both contexts (Docker Desktop maps `host.docker.internal` to the host gateway).

## Quick start

```bash
cd tests/fixtures

# 1. Spin up DB + WP. First boot copies WP core files into ./wp-data/ (~30s).
docker compose up -d

# 2. Install WordPress + create admin + create Application Password. Idempotent.
./install-wp.sh

# 3. Confirm from host:
wp --path=./wp-data option get siteurl
# → http://localhost:8989

# 4. Test wplab against it (after `npm link` + `claude mcp add wplab`):
#    /tools rolepod_wp_connect_local { "path": "<absolute path to wp-data>" }
```

## Credentials

| Surface | Value |
|---|---|
| Admin login | `wplabadmin` / `wplabadmin-dev-only` |
| Admin email | `dev@wplab.local` |
| App Password label | `rolepod-wplab` (raw password printed once by `install-wp.sh`) |
| MariaDB root | `rootpass` |
| MariaDB user | `wplab` / `wplabpass`, database `wplab` |

These are **fixture credentials for local development only**. Never reuse them on any real WP install.

## Teardown

```bash
./teardown.sh    # drops containers + volumes + wp-data/. Use when state is corrupted.
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `host.docker.internal` doesn't resolve from host | Docker Desktop should add it to `/etc/hosts`. Check `cat /etc/hosts \| grep docker.internal`. If missing, append `127.0.0.1 host.docker.internal` manually. |
| Port 3307 / 8989 already in use | Edit the host-side port in `docker-compose.yml`. Make sure to also update `WORDPRESS_DB_HOST` if you change 3307. |
| WP files owned by uid 33, `rm` refuses | Use `./teardown.sh` which falls back to `sudo rm -rf`. |
| `wp core install` fails with "Could not establish a database connection" | Check that the db container is healthy: `docker compose ps`. Try `docker compose logs db`. |
| WP admin login redirects forever | The first `wp_core_install` may seed an outdated siteurl. Re-run `./install-wp.sh` — it's idempotent. |
