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

Read-only list sharing is disabled unless a separate recipient-reachable origin
is configured:

```dotenv
PUBLIC_SHARE_BASE_URL=https://stickers.example.net
```

For sharing only inside a LAN, an address such as
`http://192.168.1.50:3500` is valid. `localhost`, loopback addresses, credentials,
paths, queries, and fragments are rejected because they cannot form dependable
recipient links. Prefer HTTPS whenever links leave a trusted private network.
The setting controls generated links only; `APP_BASE_URL` remains the
browser-visible origin used for authentication and origin checks.
On a new assisted installation, `start.sh` copies its detected LAN, DNS, VPN, or
explicit `STICKERFOLIO_URL` origin into this setting when that origin is not a
loopback address. Existing `.env` files are never changed automatically.

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
- `PUBLIC_SHARE_BASE_URL`: optional recipient-reachable HTTP or HTTPS origin
  that enables read-only sharing;
- `BETTER_AUTH_SECRET`: random value of at least 32 characters;
- `POSTGRES_PASSWORD`: unique database password;
- `REGISTRATION_MODE`: `closed`, `invitation`, or `open`;
- `APP_PORT`: optional host port, default `3500`.

Reserved URL characters in database passwords must be percent-encoded when they appear in a PostgreSQL URL.

## External PostgreSQL

Use PostgreSQL 17 or a compatible managed service. External Compose defaults to
`verify-full`; configure the database URL and the CA certificate supplied by
the database operator in `.env`:

```dotenv
DATABASE_URL=postgresql://stickerfolio:encoded-password@db.example.net:5432/stickerfolio
DATABASE_SSL_MODE=verify-full
DATABASE_SSL_CA="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
```

The hostname in `DATABASE_URL` must match the database certificate. Keep TLS
options out of the URL and configure them through `DATABASE_SSL_MODE` and
`DATABASE_SSL_CA`, so the application applies one unambiguous TLS policy.

Then start the external deployment:

```bash
docker compose --file compose.external.yml up --detach --build
```

The external Compose variant builds the same standalone application and
operations images but defines no PostgreSQL container or database volume. The
application image contains only the traced Next.js server and static assets.
The separate operations image retains the TypeScript migration and seed tools;
it is used by the short-lived `migrate` service and is not the web runtime.

| Mode | Protection | Appropriate use |
| --- | --- | --- |
| `verify-full` | Encrypts the connection and verifies the certificate and database hostname using `DATABASE_SSL_CA`. | Recommended for production and the external Compose default. |
| `verify-ca` | Uses the supplied CA for certificate verification. | Verified compatibility mode; prefer `verify-full` because it explicitly expresses the required hostname-verification policy. |
| `require` | Encrypts traffic but accepts an unverified server identity. | Temporary compatibility or troubleshooting only; it remains vulnerable to an active man-in-the-middle endpoint. |
| `disable` | Sends database traffic without TLS. | Only an explicitly trusted, isolated private link, such as a private container network or a separately protected tunnel. |

`DATABASE_SSL_CA` is mandatory for `verify-ca` and `verify-full`; startup fails
with a configuration error when it is missing. Treat the CA as trusted
configuration and obtain it through the database provider or operator rather
than downloading it from an unverified endpoint.

> [!WARNING]
> Do not use `require` merely because a provider describes it as “SSL
> required.” It provides encryption without authenticating which PostgreSQL
> server received the credentials. Use `verify-full` unless a documented,
> separately secured network boundary makes that impossible.

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
