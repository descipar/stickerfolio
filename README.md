# Stickerfolio

Stickerfolio is a self-hosted, smartphone-optimized tracker for sticker albums. Collectors are created and selected directly in the application. The current version does not require authentication and is intended for use on a home network or through a VPN.

## Features

- Multiple collectors with separate albums and holdings.
- Mark missing stickers as owned with one tap.
- Increase or decrease owned quantities and duplicates.
- Search by sticker code, section, or team.
- Filter missing, owned, and duplicate stickers.
- Show overall progress and progress per section.
- Import arbitrary albums from CSV.
- Export holdings as CSV or JSON.
- Extensible data model for multiple collectors.
- Mobile web app for the iPhone home screen.

A new installation starts without albums or sticker holdings.

## Roadmap

The planned greenfield rewrite as a portable multi-user application with PostgreSQL, authentication, administration, a shared album catalog, and trade-partner matching is described in the [product and architecture roadmap](docs/ROADMAP.md). It contains the agreed architecture and product decisions and is the foundation for the new implementation.

Implementation work is tracked through the repository's [GitHub Issues](https://github.com/descipar/stickerfolio/issues).

## Local development

Requirements: Node.js 22 and pnpm 11.

```bash
pnpm install
pnpm dev
```

The application is then available at `http://localhost:3000`. The local database is created at `data/stickerfolio.db`. The first collector is created in the application on first use.

## Raspberry Pi 4

Raspberry Pi OS 64-bit with Docker and Docker Compose is recommended.

Because the repository is private, the GitHub account password cannot be used for cloning. SSH is recommended. Generate a key on the Raspberry Pi once:

```bash
ssh-keygen -t ed25519 -C "stickerfolio-raspberry-pi"
cat ~/.ssh/id_ed25519.pub
```

Add the displayed public key to GitHub under **Settings → SSH and GPG keys → New SSH key**. Then verify the connection and clone the repository:

```bash
ssh -T git@github.com
git clone git@github.com:descipar/stickerfolio.git
cd stickerfolio
docker compose build --pull
docker compose up -d
```

The container starts without collector or album data. Create collectors and import albums through the application.

Alternatively, clone over HTTPS with a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new). The token needs only **Contents: Read-only** access to `descipar/stickerfolio`. Use `descipar` as the username and enter the token, not the GitHub password, when prompted for a password:

```bash
git clone https://github.com/descipar/stickerfolio.git
```

On iPhone, open Stickerfolio at `http://<RASPBERRY-PI-IP>:3500` or `http://raspberrypi.local:3500`. In Safari, use **Share → Add to Home Screen** to install it as a web app.

### Updating

Stickerfolio is always built from the current source code directly on the Raspberry Pi. Create a backup before updating, pull the source, and rebuild the image:

```bash
cd stickerfolio
./scripts/backup.sh
git pull
docker compose build --pull
docker compose up -d
docker compose ps
```

`docker compose build --pull` downloads only current base images such as Node.js and then builds Stickerfolio locally. It does not download a prebuilt Stickerfolio image from GitHub or GHCR. The database in `data/` is preserved.

### Full reset

The following command removes the container, locally built image, and all collector, album, and holding data. Stickerfolio is then rebuilt and started completely empty:

```bash
./scripts/reset.sh
```

Create the first collector in the application again.

### Managing collectors

Collectors are managed exclusively through the application. Open collector management through the name in the upper-right corner. Additional collectors can be created there, and the active collector can be changed. The browser stores the selection; Docker and `compose.yaml` do not need to be changed.

## Data and backup

The SQLite database is stored persistently in `data/` next to the Compose file. It is not included in the Docker image and survives updates.

Existing installations retain their stored collector and album data. Only a newly created database starts without album data.

Create a consistent backup with:

```bash
./scripts/backup.sh
```

Each album can also be exported directly from the application as CSV or JSON.

## Importing additional albums

The CSV file must use UTF-8 and contain these columns:

```csv
section_code,section_name,sticker_code,sticker_number,label
GER,Germany,GER1,1,Sticker GER1
GER,Germany,GER2,2,Sticker GER2
```

`section` is intentionally generic and may represent a team, album page, or any other category. Newly imported stickers start as missing.

## Data model

- `collectors`: collectors
- `albums`: album catalogs
- `sections`: teams, pages, or categories
- `stickers`: stickers in an album
- `collections`: assignment of an album to a collector
- `holdings`: quantity of a sticker in a collection

The active collector is selected in the application and stored in a browser cookie. Albums and holdings remain separated by collector in the SQLite database.

## Quality assurance

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm seed:build
```
