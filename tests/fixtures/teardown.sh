#!/usr/bin/env bash
# tests/fixtures/teardown.sh — drop containers + volumes + bind-mounted WP files.
#
# Safe to run repeatedly. Use this when the fixture state is corrupted or you
# want a clean install.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[teardown] stopping compose stack ..."
docker compose -f "$HERE/docker-compose.yml" down -v --remove-orphans

if [ -d "$HERE/wp-data" ]; then
  echo "[teardown] removing $HERE/wp-data ..."
  # WP files written by container are owned by uid 33 (www-data). Use sudo if needed.
  if ! rm -rf "$HERE/wp-data" 2>/dev/null; then
    echo "[teardown] regular rm failed — files owned by container user. Trying sudo:"
    sudo rm -rf "$HERE/wp-data"
  fi
fi

echo "[teardown] done."
