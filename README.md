# Stickerfolio

Stickerfolio is a portable, mobile-first web application for managing sticker albums together without mixing up personal collections. Each collector gets an independent account, can collect multiple albums, and records the exact number of copies owned for every sticker. A quantity of zero means the sticker is missing, one means it is part of the collection, and every additional copy is available as a duplicate.

The application is designed for the moment when a physical sticker collection becomes too large for handwritten lists. On a phone, collectors can quickly search by sticker code or team, filter an album by section and collection status, check off newly acquired stickers, and increase or decrease duplicate quantities. Progress, missing stickers, and spare copies remain visible per album while the shared catalog keeps sticker identities consistent between collectors and across album revisions.

Stickerfolio currently provides:

- authenticated, strictly separated collector accounts;
- multiple personal albums per collector;
- mobile-friendly sticker, team, search, and status views;
- quantities from zero through 99, including explicit duplicate counts;
- private, opt-in trade matching with one-way and two-way suggestions;
- trade filters by team or section, match type, and compatibility;
- separate CSV exports for missing stickers and available duplicates;
- self-service and administrator-managed login email changes with session revocation;
- configurable registration modes (closed, invitation-only, or open self-registration) with guided first-run onboarding;
- self-service account deactivation and permanent, confirmation-gated account deletion;
- administrator-managed users and portable album templates;
- PostgreSQL persistence with self-hosted Docker deployment by default.

Trading is a central part of Stickerfolio. Collectors can opt in from their account settings and then open **Find trade partners** from an album. Stickerfolio compares missing stickers with actual spare copies from other opted-in collectors who collect the same logical album. It distinguishes one-way opportunities from two-way matches, ranks the strongest matches first, and supports filtering by team or section and sorting by what either collector can offer.

Matching is intentionally read-only and privacy-preserving. Participation is disabled by default. Results expose only the other collector's display name and the sticker codes relevant to that possible exchange—never email addresses or complete holdings. Matching uses stable sticker identities, so compatible stickers remain comparable when collectors use different published revisions of an album and the printed codes have changed. Viewing, filtering, or sorting matches never changes quantities, reserves stickers, or claims that a trade has happened.

Collectors can also download two focused CSV files for each personal album: a wanted list containing every missing sticker and a swap list containing every duplicate together with its available spare count. Trade requests and in-app messages remain possible future additions and are tracked in the [GitHub issues](https://github.com/descipar/stickerfolio/issues).

## Bundled album catalogs

Stickerfolio currently includes two reviewed, optional catalogs:

| Album | Edition | Tracked items |
| --- | --- | ---: |
| Panini FIFA World Cup 2026 | 2026 checklist edition | 994 stickers |
| Topps UEFA EURO 2024 | Standard German edition | 707 physical sticker carriers |

The EURO 2024 count follows physical items that can be owned and traded: combined stickers such as `POL2+3` remain one quantity, while optional parallel variants do not count as additional completion requirements. The exact scope and source notes are documented in [Supported album catalogs](docs/SUPPORTED_ALBUMS.md). Other albums can be added through the provider-neutral [portable album template format](docs/ALBUM_TEMPLATE_FORMAT.md).

## Mobile interface

Stickerfolio is designed around the quick checks collectors make while opening packs, sorting duplicates, and comparing albums. The responsive interface keeps collection progress, team filters, missing stickers, and spare-copy quantities usable on a phone without hiding the underlying album structure.

The screenshots use neutral demonstration data:

| Album overview | Sticker and team view |
| --- | --- |
| <img src="docs/images/stickerfolio-albums-mobile.png" width="390" alt="Mobile Stickerfolio album overview with collection progress, missing stickers, and duplicate totals"> | <img src="docs/images/stickerfolio-album-detail-mobile.png" width="390" alt="Mobile Stickerfolio album detail with team filters, missing stickers, owned stickers, and duplicate quantities"> |

### Private trade matching

Trade matching is a deliberate opt-in. Once enabled, each personal album can show relevant partners without revealing private account or collection data.

| Trading preference | Trade matches |
| --- | --- |
| <img src="docs/images/stickerfolio-trading-preference-mobile.png" width="390" alt="Mobile Stickerfolio account setting for opting in to trade matching"> | <img src="docs/images/stickerfolio-trade-matches-mobile.png" width="390" alt="Mobile Stickerfolio trade matching view with filters and relevant exchangeable stickers"> |

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

The script detects the Raspberry Pi address, generates private database and authentication secrets, builds and starts the containers, applies migrations, and loads the bundled empty album catalogs. It creates no collector, personal album, holding, duplicate, or example holding. In particular, the optional example holdings dataset is never loaded by this script.

At the end, the script prints the application URL and the restricted bootstrap login. The initial administrator must change the temporary password before using the administration area.

If automatic address detection is unsuitable, provide the externally used URL explicitly:

```bash
STICKERFOLIO_URL=http://192.168.20.102:3500 ./start.sh
```

Running `./start.sh` again is safe: existing secrets and PostgreSQL data are retained, and the catalog seed is idempotent.

## Current status

The repository contains the first usable MVP: PostgreSQL persistence, Better Auth sessions, administrator-managed user accounts, configurable registration (closed, invitation-only, or open self-registration) with guided first-run onboarding, self-service and administrator-managed login email changes, self-service account deactivation and permanent account deletion, administrator-managed album templates, multiple personal albums, mobile sticker search and filters, quantity tracking from zero through 99, separate CSV exports, and private opt-in trade matching. Security-sensitive account and album-publication actions are emitted as data-minimized structured audit events. Binding trade requests and in-app messaging remain on the [GitHub roadmap](https://github.com/descipar/stickerfolio/issues).

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

`AUTH_TRUSTED_IP_HEADER` is optional and must remain empty for direct deployments. Set it only when Stickerfolio is reachable exclusively through a trusted reverse proxy that removes any client-supplied value and writes the real client address into that single-value header. For example, a correctly configured proxy may use `X-Real-IP`. Stickerfolio deliberately ignores `X-Forwarded-For` and every other forwarded address by default so clients cannot rotate spoofed values to evade authentication limits.

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

Use **Album templates** to upload a portable JSON template or generate a small starter document in the browser. Every administrative import is validated atomically and created as a draft, regardless of the status contained in the uploaded document. Publishing a draft archives the previously published revision while existing personal collections remain pinned to their original revision. Archiving a published revision without a replacement prevents new collections for that album but does not modify existing holdings.

## Using personal collections

After an administrator has published an album template, collectors can add that album to their personal collection. Inside an album, use the search field, status filters, and horizontally scrollable section or team selector to find stickers on both desktop and mobile. Set a quantity to zero for a missing sticker, one for an owned sticker, or a higher value when spare copies are available.

The album view provides separate **Export missing list (CSV)** and **Export duplicates list (CSV)** actions. The missing export contains every sticker with quantity zero. The duplicates export contains only quantities greater than one and includes both the total quantity and the number of spare copies. Exports contain only the signed-in collector's own collection data.

Every user can change their own login address from **Account** after confirming the current password. Administrators can also correct another user's address from **Users**. A successful change signs the affected user out on all devices; the next login uses the normalized new address.

From **Account**, a user can also deactivate their account or permanently delete it. Deactivation is a reversible suspension that revokes every session and blocks sign-in until an administrator reactivates the account. Deletion is irreversible and requires confirming the current password and typing the exact login email. Administrators manage suspension, reactivation, and deletion for other users from **Users**, and the last active administrator can never be removed, suspended, or demoted.

## Using trade matching

Trade matching is disabled for every new collector. To participate, open **Account** and enable **Appear in trade matching**. The change takes effect immediately: disabling it removes the collector from other users' results and also hides their own results.

Open a personal album and choose **Find trade partners**. Matches are based on missing stickers (quantity zero) and duplicates (quantity greater than one) in active collections of the same album. A two-way match means both collectors can offer at least one needed sticker; a one-way match helps only one side. Use the controls to filter by team or album section, show only one-way or two-way matches, and sort by compatibility, offered stickers, wanted stickers, or collector name.

Only the partner's display name and relevant sticker details are returned. When album revisions use different printed codes for the same stable sticker, both codes are shown. The feature does not expose login email addresses, unrelated stickers, or complete foreign holdings, and administrators do not receive blanket access to collector matches.

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

## Optional catalog and example seeds

Database migrations create no album, collector profile, collection, or holding. Only the restricted bootstrap administrator described above is created on an empty installation. The bundled catalogs can be loaded explicitly and idempotently:

```bash
pnpm seed:catalogs
```

The individual `seed:wm2026` and `seed:euro2024` commands load only one catalog. In a Compose deployment, load both from the built image with:

```bash
docker compose run --rm app node node_modules/tsx/dist/cli.mjs scripts/seed-bundled-catalogs.ts
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

## HTTP security baseline

Login attempts are limited to five requests per minute and client address. The open self-registration and invitation-redemption endpoints are each limited to ten requests per minute and client address. These counters are held in the application process: they are appropriate for the documented single-instance deployment, but multiple application replicas are unsupported until the limiter uses shared storage.

Without a configured trusted client IP header, all callers share a conservative per-endpoint bucket. This is safe against spoofed forwarding headers, but may cause one busy client to throttle others temporarily. Configure a trusted overwritten header only when the origin cannot be reached around the reverse proxy.

State-changing API requests are checked against `APP_BASE_URL` using the browser `Origin` and Fetch Metadata headers. Session cookies are HTTP-only and `SameSite=Lax`; HTTPS deployments also receive Secure cookies. JSON request bodies are limited to 32 KiB, album-template imports to 2 MiB, and responses include a restrictive content security policy, clickjacking protection, MIME sniffing protection, a limited referrer policy, and disabled camera, location, and microphone access. TLS termination should add HSTS after HTTPS has been verified for the complete public hostname.

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
