# Stickerfolio

Stickerfolio is being rebuilt as a portable, mobile-first sticker album tracker for multiple authenticated collectors.

This branch contains the greenfield v2 implementation. The previous SQLite-based application remains available through the [`v1.0.0-legacy`](https://github.com/descipar/stickerfolio/tree/v1.0.0-legacy) tag.

## Current status

The repository currently provides the initial Next.js foundation only. Album catalogs, collectors, authentication, PostgreSQL, and trade matching are intentionally implemented through later [GitHub Issues](https://github.com/descipar/stickerfolio/issues).

The agreed product and architecture decisions are documented in the [roadmap](docs/ROADMAP.md).

## Requirements

- Node.js 22 or newer
- pnpm 11

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
pnpm dev
```

Open `http://localhost:3500`.

## Quality checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Production start

```bash
pnpm build
pnpm start
```

The production server listens on port `3500`.

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

The module directories are placeholders in the foundation issue. Their public APIs and enforced import boundaries are introduced in the next implementation issue.
