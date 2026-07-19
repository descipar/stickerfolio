# Stickerfolio

Stickerfolio is a portable, mobile-first sticker album tracker for multiple authenticated collectors.

## Quick start on Raspberry Pi

GitHub no longer accepts account passwords for Git operations. Because this repository is private, configure a read-only SSH deploy key once on the Raspberry Pi:

```bash
test -f ~/.ssh/id_ed25519 || ssh-keygen -t ed25519 -C "stickerfolio-rpi"
cat ~/.ssh/id_ed25519.pub
```

Accept the suggested key location and leave the passphrase empty so unattended updates remain possible. Add the displayed public key in the GitHub repository under **Settings → Deploy keys → Add deploy key**. Do not enable write access.

After that one-time setup, a fresh installation needs only:

```bash
git clone git@github.com:descipar/stickerfolio.git
cd stickerfolio
./start.sh
```

The script detects the Raspberry Pi address, generates private database and authentication secrets, builds and starts the containers, applies migrations, and loads the empty World Cup 2026 catalog. It creates no collector, personal album, holding, duplicate, or example holding. In particular, the optional example holdings dataset is never loaded by this script.

At the end, the script prints the application URL and the restricted bootstrap login. The initial administrator must change the temporary password before using the administration area.

If automatic address detection is unsuitable, provide the externally used URL explicitly:

```bash
STICKERFOLIO_URL=http://192.168.20.102:3500 ./start.sh
```

Running `./start.sh` again is safe: existing secrets and PostgreSQL data are retained, and the catalog seed is idempotent.

## Current status

The repository contains the first usable MVP: PostgreSQL persistence, Better Auth sessions, administrator-managed user accounts, multiple personal albums, mobile sticker search and filters, and quantity tracking from zero through 99. Trade matching, self-registration, invitations, and catalog administration remain on the [GitHub roadmap](https://github.com/descipar/stickerfolio/issues).

The agreed product and architecture decisions are documented in the [roadmap](docs/ROADMAP.md).
The provider-neutral catalog interchange contract is documented in the [album template format](docs/ALBUM_TEMPLATE_FORMAT.md).
Password hash parameters and the Raspberry Pi benchmark command are documented in [Password hashing](docs/PASSWORD_HASHING.md).

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

On a completely empty database, the migration command creates exactly one restricted bootstrap account:

- email: `admin@stickerfolio.local`
- initial password: `admin123!`

The bootstrap account must choose a new password before any administration feature is available. It has no collector profile, album, or holdings. After changing the password, use **Users** to create normal accounts with a display name and temporary password. Every newly created user must also change that password at first sign-in.

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

## Optional example seeds

No album, collector profile, collection, or holding is created automatically. Only the restricted bootstrap administrator described above is created on an empty installation. The verified World Cup 2026 catalog can be loaded explicitly and idempotently:

```bash
pnpm seed:wm2026
```

In a Compose deployment, run the same seed from the built image:

```bash
docker compose run --rm app node node_modules/tsx/dist/cli.mjs scripts/seed-wm2026.ts
```

The repository also contains a separate example holdings dataset. It never creates a user or collector profile and requires the UUID of one unambiguous, existing profile plus an explicit dataset name:

```bash
pnpm seed:example-holdings -- --collector <profile-uuid> --dataset wm2026-example
```

Existing holding rows are not overwritten. An unknown profile, missing catalog revision, or collection on a different revision aborts the transaction without changes. Both seed commands use `DATABASE_URL`, so bundled and external PostgreSQL follow the same data path.

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

## License

Stickerfolio is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE).

You may use, modify, and distribute this software for **noncommercial purposes** only — including personal, hobby, educational, research, and use by nonprofit or government organizations. **Commercial use is not permitted** under this license. Any copy or derivative must retain the complete required attribution notice: `Required Notice: Copyright 2026 Kai Schulte (https://github.com/descipar)`.

This is a source-available license, not an OSI-approved open-source license. For commercial licensing, contact the author.
