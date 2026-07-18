#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 --compose|--external INPUT.dump" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
mode=$1
input=$2
[ -r "$input" ] || { echo "Backup file is not readable: $input" >&2; exit 2; }

case "$mode" in
  --compose)
    docker compose exec -T postgres pg_restore \
      --username "${POSTGRES_USER:-stickerfolio}" \
      --dbname "${POSTGRES_DB:-stickerfolio}" \
      --no-owner --no-acl --exit-on-error < "$input"
    ;;
  --external)
    [ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required." >&2; exit 2; }
    command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required." >&2; exit 2; }
    pg_restore --dbname "$DATABASE_URL" --no-owner --no-acl --exit-on-error "$input"
    ;;
  *) usage ;;
esac

echo "Backup restored from $input"
