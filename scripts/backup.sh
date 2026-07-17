#!/usr/bin/env sh
set -eu

mkdir -p backups
timestamp="$(date +%Y%m%d-%H%M%S)"

restart_app() {
  docker compose start app >/dev/null
}

trap restart_app EXIT
docker compose stop app >/dev/null
tar -czf "backups/stickerfolio-${timestamp}.tar.gz" data
printf 'Backup erstellt: backups/stickerfolio-%s.tar.gz\n' "$timestamp"
