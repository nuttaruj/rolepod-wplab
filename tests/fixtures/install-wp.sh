#!/usr/bin/env bash
# tests/fixtures/install-wp.sh
#
# Idempotently install + configure the fixture WordPress:
#   - Wait for the container to copy WP core files into ./wp-data/
#   - Run `wp core install` (skip if already installed)
#   - Create an Application Password for the admin user (skip if already exists)
#   - Print connection info for the maintainer to feed into wplab
#
# Requires:
#   - docker compose stack already running (see docker-compose.yml)
#   - wp-cli on host PATH (`brew install wp-cli` on macOS)

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WP_DIR="$HERE/wp-data"
SITE_URL="http://localhost:8989"
SITE_TITLE="rolepod-wplab fixture"
ADMIN_USER="wplabadmin"
ADMIN_PASS="wplabadmin-dev-only"
ADMIN_EMAIL="dev@wplab.local"
APP_PASS_LABEL="rolepod-wplab"

wp_cmd() {
  wp --path="$WP_DIR" --skip-themes --skip-plugins "$@"
}

echo "[install-wp] waiting for WP core files in $WP_DIR ..."
for _ in $(seq 1 60); do
  [ -f "$WP_DIR/wp-config.php" ] && [ -f "$WP_DIR/wp-load.php" ] && break
  sleep 1
done
if [ ! -f "$WP_DIR/wp-config.php" ]; then
  echo "[install-wp] FAIL — wp-config.php never appeared. Is the wordpress container running?" >&2
  docker compose -f "$HERE/docker-compose.yml" ps >&2
  exit 1
fi
echo "[install-wp] WP files present."

# Patch wp-config.php with a SAPI-conditional DB_HOST so the SAME file works
# from both Apache (container, web SAPI → db:3306) AND host wp-cli (CLI SAPI
# → 127.0.0.1:3307). Patcher logic lives in _patch-dbhost.php; idempotent.
echo "[install-wp] patching wp-config.php for SAPI-conditional DB_HOST ..."
docker compose -f "$HERE/docker-compose.yml" cp "$HERE/_patch-dbhost.php" wordpress:/tmp/_patch-dbhost.php
docker compose -f "$HERE/docker-compose.yml" exec -T wordpress php /tmp/_patch-dbhost.php
docker compose -f "$HERE/docker-compose.yml" exec -T wordpress rm -f /tmp/_patch-dbhost.php

echo "[install-wp] waiting for DB to accept queries ..."
# Probe via in-container mariadb client (host wp-cli would need mysqlcheck binary, host doesn't have it).
for _ in $(seq 1 30); do
  if docker compose -f "$HERE/docker-compose.yml" exec -T db \
      mariadb -h 127.0.0.1 -uwplab -pwplabpass -e "SELECT 1" wplab >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker compose -f "$HERE/docker-compose.yml" exec -T db \
    mariadb -h 127.0.0.1 -uwplab -pwplabpass -e "SELECT 1" wplab >/dev/null 2>&1; then
  echo "[install-wp] FAIL — DB never accepted a query." >&2
  docker compose -f "$HERE/docker-compose.yml" logs db | tail -20 >&2
  exit 1
fi

# Second probe: confirm host wp-cli can actually round-trip to the DB via
# the patched SAPI conditional. We don't trust the wp exit code alone here
# because `if !` swallows it; instead inspect stderr text.
probe_output=$(wp_cmd core is-installed 2>&1 || true)
if echo "$probe_output" | grep -qi "Error establishing a database connection"; then
  echo "[install-wp] FAIL — host wp-cli cannot reach DB even after patch. Inspect wp-config.php:" >&2
  head -20 "$WP_DIR/wp-config.php" >&2
  echo "----- wp output:" >&2
  echo "$probe_output" >&2
  exit 1
fi

if wp_cmd core is-installed >/dev/null 2>&1; then
  echo "[install-wp] WP already installed — skipping core install."
else
  echo "[install-wp] running wp core install ..."
  wp_cmd core install \
    --url="$SITE_URL" \
    --title="$SITE_TITLE" \
    --admin_user="$ADMIN_USER" \
    --admin_password="$ADMIN_PASS" \
    --admin_email="$ADMIN_EMAIL" \
    --skip-email
fi

echo "[install-wp] checking application password ..."
EXISTING_APP_PASS_UUID=$(wp_cmd user application-password list "$ADMIN_USER" --format=csv 2>/dev/null | awk -F, -v lbl="$APP_PASS_LABEL" 'NR>1 && $2==lbl {print $1; exit}' || true)

if [ -n "$EXISTING_APP_PASS_UUID" ]; then
  echo "[install-wp] application password '$APP_PASS_LABEL' already exists (uuid $EXISTING_APP_PASS_UUID)."
  APP_PASS_DISPLAY="(reuse existing; the raw password is only shown at creation time)"
else
  echo "[install-wp] creating application password '$APP_PASS_LABEL' ..."
  APP_PASS_DISPLAY=$(wp_cmd user application-password create "$ADMIN_USER" "$APP_PASS_LABEL" --porcelain)
fi

cat <<EOF

═══════════════════════════════════════════════════════════════════
  rolepod-wplab fixture WordPress is READY
═══════════════════════════════════════════════════════════════════
  Site URL          : $SITE_URL
  Admin login       : $ADMIN_USER  /  $ADMIN_PASS
  WP install (host) : $WP_DIR
  DB (from host)    : 127.0.0.1:3307  user=wplab pass=wplabpass db=wplab
  App password      : $APP_PASS_DISPLAY
  App-pass label    : $APP_PASS_LABEL  (use with REST in v0.1+)

  Quick wp-cli sanity:
      wp --path=$WP_DIR option get siteurl

  Quick wplab connect (after \`npm link\` + \`claude mcp add wplab\`):
      /tools rolepod_wp_connect_local { "path": "$WP_DIR" }
═══════════════════════════════════════════════════════════════════
EOF
