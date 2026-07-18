#!/bin/sh
set -eu

usage() {
  echo "Usage: $0 --compose|--external OUTPUT.dump" >&2
  exit 2
}

[ "$#" -eq 2 ] || usage
mode=$1
output=$2

case "$mode" in
  --compose)
    docker compose exec -T postgres pg_dump \
      --username "${POSTGRES_USER:-stickerfolio}" \
      --dbname "${POSTGRES_DB:-stickerfolio}" \
      --format custom --no-owner --no-acl > "$output"
    ;;
  --external)
    [ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is required." >&2; exit 2; }
    command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required." >&2; exit 2; }
    pg_dump --dbname "$DATABASE_URL" --format custom --no-owner --no-acl --file "$output"
    ;;
  *) usage ;;
esac

echo "Backup written to $output"
