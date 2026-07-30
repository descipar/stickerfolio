# Seeding

Database migrations create no album, collector profile, personal collection, holding, or duplicate. They create only the restricted bootstrap administrator on a completely empty installation. Catalog and example data are separate, explicit, idempotent seeds.

## Bundled catalogs

Load every reviewed catalog maintained in the repository:

```bash
pnpm seed:catalogs
```

Load one catalog independently:

```bash
pnpm seed:wm2026
pnpm seed:euro2024
```

In a bundled Compose deployment:

```bash
docker compose run --rm migrate node node_modules/tsx/dist/cli.mjs scripts/seed-bundled-catalogs.ts
```

Catalog seeds create shared templates, revisions, sections, and stable sticker identities. Repeating a seed does not overwrite an existing revision. Exact included catalog scope is documented in [Supported album catalogs](SUPPORTED_ALBUMS.md).

`start.sh` invokes the bundled catalog seed as an explicit part of the assisted setup. Starting the application container or running migrations alone does not seed domain data.

## Optional example holdings

The repository contains a separate World Cup 2026 example dataset. It never creates a user or collector and must target one unambiguous collector profile that already exists in the application:

```bash
pnpm seed:example-holdings -- --collector <profile-uuid> --dataset wm2026-example
```

For Compose:

```bash
docker compose run --rm migrate node node_modules/tsx/dist/cli.mjs scripts/seed-example-holdings.ts \
  --collector <profile-uuid> \
  --dataset wm2026-example
```

Existing holding rows are never overwritten. An unknown profile, missing catalog revision, or personal collection pinned to a different revision aborts the transaction without partial changes.

All seed commands use `DATABASE_URL`, so bundled and external PostgreSQL installations follow the same data path.
The Compose `migrate` service uses the separate operations image that contains
the migration and seed tooling. The running application image contains only the
traced standalone server and its static assets.
