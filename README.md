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
