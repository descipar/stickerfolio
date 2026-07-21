# Deployment

Stickerfolio is a self-hosted Docker application. It does not depend on a particular cloud provider or hardware vendor and supports ARM64 and x86-64 Docker hosts. Raspberry Pi 4 is one tested, resource-conscious ARM64 option rather than a requirement.

## Prerequisites

- Docker Engine with Docker Compose v2
- Git or another way to place the repository checkout on the host
- TCP port `3500`, or another configured host port
- outbound access while building the image and pulling base images

## Assisted start

The repository includes a generic Linux Docker-host helper:

```bash
./start.sh
```

On its first run, the script:

1. verifies Docker and Compose;
2. detects a suitable host address;
3. creates `.env` with random PostgreSQL and authentication secrets;
4. builds and starts the application and bundled PostgreSQL;
5. waits for readiness;
6. loads the bundled empty album catalogs.

It creates no collector, personal collection, holding, duplicate, or example holding. Subsequent runs reuse `.env` and the named PostgreSQL volume.

Set the externally used origin when address detection is unavailable or when a reverse proxy, DNS name, VPN address, or different interface is used:

```bash
STICKERFOLIO_URL=https://stickers.example.net ./start.sh
```

`APP_BASE_URL` must exactly match the browser-visible origin. See [Security](SECURITY.md) before exposing the service beyond a trusted network.

## Private repository checkout

GitHub account passwords cannot authenticate Git operations. Suitable options include an authenticated GitHub CLI session, a personal access token used by a credential helper, or a read-only SSH deploy key.

For an unattended private host, create a dedicated deploy key:

```bash
test -f ~/.ssh/id_ed25519 || ssh-keygen -t ed25519 -C "stickerfolio-host"
cat ~/.ssh/id_ed25519.pub
```

Add the public key under the repository's **Settings → Deploy keys** without write access, then clone with:

```bash
git clone git@github.com:descipar/stickerfolio.git
```

Choose a passphrase and key-management approach appropriate for the host's update process.

## Manual bundled-PostgreSQL deployment

Copy the example configuration and replace every placeholder credential:

```bash
cp .env.example .env
docker compose up --detach --build
```

The application is published through `${APP_PORT:-3500}`. PostgreSQL is available only inside the Compose network and stores its data in the `postgres_data` named volume. The one-shot migration service must finish successfully before the application starts.

At minimum, configure:

- `APP_BASE_URL`: exact public HTTP or HTTPS origin;
- `BETTER_AUTH_SECRET`: random value of at least 32 characters;
- `POSTGRES_PASSWORD`: unique database password;
- `REGISTRATION_MODE`: `closed`, `invitation`, or `open`;
- `APP_PORT`: optional host port, default `3500`.

Reserved URL characters in database passwords must be percent-encoded when they appear in a PostgreSQL URL.

## External PostgreSQL

Use PostgreSQL 17 or a compatible managed service and set `DATABASE_URL`, pool settings, and TLS mode in `.env`:

```bash
docker compose --file compose.external.yml up --detach --build
```

The external Compose variant builds the same image but defines no PostgreSQL container or database volume. Supported TLS modes are `disable`, `require`, `verify-ca`, and `verify-full`. Use `DATABASE_SSL_CA` with verification modes and use `disable` only for a trusted private connection.

## Updating

From a clean checkout on the deployment host:

```bash
git pull --ff-only
./start.sh
```

For a manual Compose installation:

```bash
git pull --ff-only
docker compose up --detach --build
```

The migration service applies pending forward migrations before the new application container starts. Existing database data and `.env` are retained. Review release changes and keep a current backup before updating.

## Inspecting deployment state

```bash
docker compose ps
docker compose logs migrate app
curl --fail http://localhost:3500/api/health/ready
```

For external PostgreSQL, add `--file compose.external.yml` to Compose commands. Backup, restore, and recovery procedures are documented in [Operations](OPERATIONS.md).
