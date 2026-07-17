#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

echo "Stickerfolio wird vollständig zurückgesetzt …"
docker compose down --rmi local --volumes --remove-orphans

if ! rm -rf "$project_dir/data" 2>/dev/null; then
  echo "Für das Löschen der Docker-Daten werden Root-Rechte benötigt."
  sudo rm -rf "$project_dir/data"
fi

mkdir -p "$project_dir/data"
docker compose up -d --build

echo "Stickerfolio läuft leer unter http://raspberrypi.local:6000"
