# Stickerfolio

Stickerfolio is being rebuilt as a portable, mobile-first sticker album tracker for multiple authenticated collectors.

This branch contains the greenfield v2 implementation. The previous SQLite-based application remains available through the [`v1.0.0-legacy`](https://github.com/descipar/stickerfolio/tree/v1.0.0-legacy) tag.

## Current status

The repository currently provides the Next.js application foundation, PostgreSQL persistence infrastructure, and versioned schema migrations. Album catalogs, collectors, authentication, holdings, and trade matching are introduced through the remaining [GitHub Issues](https://github.com/descipar/stickerfolio/issues).

The agreed product and architecture decisions are documented in the [roadmap](docs/ROADMAP.md).
The provider-neutral catalog interchange contract is documented in the [album template format](docs/ALBUM_TEMPLATE_FORMAT.md).

## Requirements

- Node.js 22 or newer
- pnpm 11
- PostgreSQL 17 for development, or Docker for the integration test suite

## Local development

Create a local environment file from the committed placeholder configuration and replace the example values:

```bash
cp .env.example .env.local
```

Generate a dedicated authentication secret with a password manager or a cryptographically secure random generator. Never reuse the placeholder value outside local development.

The required settings are:

- `DATABASE_URL`: bundled or external PostgreSQL connection URL
- `APP_BASE_URL`: public HTTP or HTTPS origin of this installation
- `BETTER_AUTH_SECRET`: random secret with at least 32 characters
- `REGISTRATION_MODE`: `closed`, `invitation`, or `open`

Optional PostgreSQL TLS and SMTP settings are documented in [.env.example](.env.example). Invalid or missing required configuration stops server startup with a redacted error message.

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

Open `http://localhost:3500`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm test:unit` runs without external services. `pnpm test:integration` starts an isolated PostgreSQL 17 container, applies the production migrations, and exercises real queries and transactions. Docker must be available for that command.

## Database migrations

Apply every pending forward migration before starting a new application version:

```bash
pnpm db:migrate
```

For local migration development, `pnpm db:migrate:down` reverts exactly one migration. Production deployments should roll forward with a corrective migration instead of rewriting migration history.

## Docker deployment with bundled PostgreSQL

Copy the example configuration, replace the authentication secret and PostgreSQL password, and set `APP_BASE_URL` to the URL used by browsers:

```bash
cp .env.example .env
docker compose up -d --build
```

The application is published on host port `3500`; PostgreSQL is reachable only inside the Compose network. The one-shot `migrate` service must complete before the application starts. Database files live in the named `postgres_data` volume and survive container and image replacement.

Inspect startup and health with:

```bash
docker compose ps
docker compose logs migrate app
curl --fail http://localhost:3500/api/health/ready
```

Change `APP_PORT` if port 3500 is unavailable. Keep `APP_BASE_URL` aligned with the URL used to reach the installation. Reserved URL characters in `POSTGRES_PASSWORD` must be percent-encoded because the password becomes part of `DATABASE_URL` inside Compose.

## Docker deployment with external PostgreSQL

The external variant uses the identical image and migration command but defines no PostgreSQL service or volume. Set `DATABASE_URL` and the appropriate TLS mode in `.env`, then run:

```bash
docker compose --file compose.external.yml up -d --build
```

Use `DATABASE_SSL_MODE=require` for encrypted connections without CA verification, or `verify-ca`/`verify-full` together with `DATABASE_SSL_CA` for verified TLS. Use `disable` only on a trusted private connection.

## PostgreSQL backup and restore

Backups must be stored outside containers and committed volumes. Create a directory owned by the operator, then use the bundled-database mode:

```bash
mkdir -p backups
./scripts/postgres-backup.sh --compose backups/stickerfolio.dump
```

Restore only into an empty database. Stop the application first when restoring the active installation:

```bash
docker compose stop app
docker compose exec postgres dropdb --force --username stickerfolio stickerfolio
docker compose exec postgres createdb --username stickerfolio --owner stickerfolio stickerfolio
./scripts/postgres-restore.sh --compose backups/stickerfolio.dump
docker compose start app
```

The drop command permanently deletes the current database. Keep and verify the backup before running it.

For an external database, install PostgreSQL 17 client tools on the operator machine and provide the URL through the environment rather than a script argument:

```bash
DATABASE_URL='postgresql://...' ./scripts/postgres-backup.sh --external backups/stickerfolio.dump
DATABASE_URL='postgresql://...' ./scripts/postgres-restore.sh --external backups/stickerfolio.dump
```

The restore target must be empty in both modes. The CI deployment test creates a fresh secondary database, restores the dump there, and verifies its migration history.

## Manual production start

```bash
pnpm build
pnpm start
```

The production server listens on port `3500`.

## Health and version endpoints

- `GET /api/health/live` reports process liveness without contacting PostgreSQL.
- `GET /api/health/ready` verifies PostgreSQL connectivity and the migrated schema.
- `GET /api/version` exposes the application and schema versions for operational diagnostics.

Responses are never cached. Operational events are written as structured JSON and redact credential fields, tokens, and complete PostgreSQL connection URLs.

## Project structure

```text
src/
├── app/                    Next.js pages and HTTP endpoints
├── components/             Reusable UI components
├── modules/
│   ├── identity/           Users, authentication, sessions, and roles
│   ├── collectors/         Collector profiles and visibility
│   ├── catalog/            Album templates, sections, and stickers
│   ├── collections/        Personal albums and holdings
│   ├── trading/            Potential trade-partner matching
│   └── admin/              Administrative use cases
└── infrastructure/
    ├── database/           PostgreSQL, queries, and migrations
    ├── email/              Replaceable SMTP adapter
    └── storage/            Optional file-storage adapter
```

Modules expose their public APIs through their root `index.ts` files. Imports between modules, and direct database access from the UI or HTTP layer, are enforced by ESLint. See [Application architecture](docs/ARCHITECTURE.md) for the dependency graph and persistence rules.
