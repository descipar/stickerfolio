#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

fail() {
  printf '\nStickerfolio setup failed: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker is not installed."
docker compose version >/dev/null 2>&1 || fail "Docker Compose is not available."
docker info >/dev/null 2>&1 || fail "The Docker service is not running or is not accessible."

detect_ip() {
  local detected=""
  if command -v ip >/dev/null 2>&1; then
    detected="$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')"
  fi
  if [[ -z "$detected" ]] && command -v hostname >/dev/null 2>&1; then
    detected="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  printf '%s' "$detected"
}

random_hex() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

if [[ ! -f .env ]]; then
  if [[ -n "${STICKERFOLIO_URL:-}" ]]; then
    app_url="$STICKERFOLIO_URL"
  else
    host_ip="$(detect_ip)"
    [[ -n "$host_ip" ]] || fail "The host address could not be detected. Run STICKERFOLIO_URL=http://YOUR-HOST:3500 ./start.sh."
    app_url="http://${host_ip}:3500"
  fi
  postgres_password="$(random_hex)"
  auth_secret="$(random_hex)"

  printf '%s\n' \
    "APP_BASE_URL=${app_url}" \
    "APP_PORT=3500" \
    "POSTGRES_PASSWORD=${postgres_password}" \
    "BETTER_AUTH_SECRET=${auth_secret}" \
    "REGISTRATION_MODE=closed" > .env
  chmod 600 .env
  printf 'Created a private .env configuration for %s.\n' "$app_url"
else
  app_url="$(awk -F= '/^APP_BASE_URL=/{sub(/^[^=]*=/, ""); print; exit}' .env)"
  [[ -n "$app_url" ]] || fail ".env exists but APP_BASE_URL is missing."
  printf 'Using the existing .env configuration for %s.\n' "$app_url"
fi

printf '\nBuilding and starting Stickerfolio...\n'
docker compose up --detach --build

printf '\nWaiting for the application to become healthy...\n'
app_container=""
for _ in {1..90}; do
  app_container="$(docker compose ps --quiet app 2>/dev/null || true)"
  if [[ -n "$app_container" ]]; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_container" 2>/dev/null || true)"
    if [[ "$health" == "healthy" ]]; then
      break
    fi
    if [[ "$health" == "unhealthy" || "$health" == "exited" || "$health" == "dead" ]]; then
      docker compose logs --tail 100 migrate app >&2
      fail "The application container did not start successfully."
    fi
  fi
  sleep 2
done

[[ -n "$app_container" ]] || fail "The application container was not created."
health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$app_container")"
[[ "$health" == "healthy" ]] || fail "The application did not become healthy in time."

printf '\nLoading the bundled empty album catalogs...\n'
docker compose exec --no-TTY app node node_modules/tsx/dist/cli.mjs scripts/seed-bundled-catalogs.ts

printf '\nStickerfolio is ready.\n\n'
printf 'Open:     %s\n' "$app_url"
printf 'Email:    admin@stickerfolio.local\n'
printf 'Password: admin123!\n\n'
printf 'You must change the initial password after signing in.\n'
printf 'No collector, personal album, holding, duplicate, or example holding was created.\n'
