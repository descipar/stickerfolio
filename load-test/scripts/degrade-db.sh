#!/usr/bin/env bash
# Degrade the PostgreSQL used by the load-test target, for the slow/unavailable
# database scenario (Roadmap 12.3, issue #43). Run this WHILE load-test/k6/slow-db.js
# is running against the same deployment.
#
# Subcommands:
#   pause                 Pause PostgreSQL (temporarily unavailable). Use with `unpause`.
#   unpause               Resume PostgreSQL after `pause`.
#   outage <seconds>      Pause PostgreSQL for <seconds>, then resume automatically.
#   latency <ms>          Add <ms> network latency in front of PostgreSQL.
#
# `pause`/`outage` use Docker Compose and need no extra tooling. `latency`
# requires a network-fault tool (toxiproxy or pumba); the command prints the
# exact recipe rather than silently doing nothing, so the scenario stays honest.
set -Eeuo pipefail

COMPOSE="${COMPOSE:-docker compose}"
SERVICE="${POSTGRES_SERVICE:-postgres}"

usage() { sed -n '2,20p' "$0"; exit "${1:-0}"; }

case "${1:-}" in
  pause)
    $COMPOSE pause "$SERVICE"
    echo "PostgreSQL paused. Run '$0 unpause' to resume." ;;
  unpause)
    $COMPOSE unpause "$SERVICE"
    echo "PostgreSQL resumed." ;;
  outage)
    seconds="${2:?usage: $0 outage <seconds>}"
    echo "Pausing PostgreSQL for ${seconds}s..."
    $COMPOSE pause "$SERVICE"
    trap '$COMPOSE unpause "$SERVICE" >/dev/null 2>&1 || true' EXIT
    sleep "$seconds"
    $COMPOSE unpause "$SERVICE"
    trap - EXIT
    echo "PostgreSQL resumed after ${seconds}s." ;;
  latency)
    ms="${2:?usage: $0 latency <ms>}"
    cat <<HELP
Latency injection needs a network-fault proxy. Two documented options:

1) toxiproxy (recommended): put toxiproxy between the app and PostgreSQL, then
     toxiproxy-cli toxic add stickerfolio-db -t latency -a latency=${ms}
     toxiproxy-cli toxic remove stickerfolio-db -n latency_downstream

2) pumba + tc (netem) against the postgres container:
     pumba netem --duration 60s delay --time ${ms} \\
       "\$($COMPOSE ps -q $SERVICE)"

Both keep the target reachable but slow, which is what slow-db.js probes.
HELP
    ;;
  *) usage 1 ;;
esac
