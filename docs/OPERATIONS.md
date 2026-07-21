# Operations

This document covers database migrations, health checks, backup, restore, and routine recovery. Deployment configuration is documented separately in [Deployment](DEPLOYMENT.md).

## Database migrations

Apply every pending forward migration before starting a new application version:

```bash
pnpm db:migrate
```

Both Compose variants run the same migration command in a one-shot service before starting the application. For local migration development, `pnpm db:migrate:down` reverts exactly one migration. Production deployments should roll forward with a corrective migration instead of rewriting or reverting published migration history.

## Health and version endpoints

- `GET /api/health/live` reports process liveness without contacting PostgreSQL.
- `GET /api/health/ready` verifies PostgreSQL connectivity and the migrated schema.
- `GET /api/version` reports application and schema versions for diagnostics.

These responses are not cached. Inspect Compose state and recent logs with:

```bash
docker compose ps
docker compose logs --tail 100 migrate app
curl --fail http://localhost:3500/api/health/live
curl --fail http://localhost:3500/api/health/ready
curl --fail http://localhost:3500/api/version
```

## Backup with bundled PostgreSQL

Store backups outside containers and committed volumes:

```bash
mkdir -p backups
./scripts/postgres-backup.sh --compose backups/stickerfolio.dump
```

Keep multiple dated copies on storage that is independent of the Docker host. A backup is not verified until it has been restored successfully into an empty test database.

## Restore with bundled PostgreSQL

The target database must be empty. Restoring the active installation is destructive, so verify the backup first and stop the application:

```bash
docker compose stop app
docker compose exec postgres dropdb --force --username stickerfolio stickerfolio
docker compose exec postgres createdb --username stickerfolio --owner stickerfolio stickerfolio
./scripts/postgres-restore.sh --compose backups/stickerfolio.dump
docker compose start app
```

The `dropdb` command permanently deletes the current database. Do not run it without a readable, independently stored backup.

## External PostgreSQL backup and restore

Install PostgreSQL 17 client tools on the operator machine and pass the connection URL through the environment:

```bash
DATABASE_URL='postgresql://...' ./scripts/postgres-backup.sh --external backups/stickerfolio.dump
DATABASE_URL='postgresql://...' ./scripts/postgres-restore.sh --external backups/stickerfolio.dump
```

The external restore target must also be empty. Follow the provider's maintenance and connection-security guidance without introducing provider-specific assumptions into Stickerfolio configuration.

## Recovery checks

After a restore or failed update:

1. confirm that migrations complete;
2. check `/api/health/ready`;
3. sign in with a non-bootstrap account;
4. verify an album and its quantities;
5. test a CSV export;
6. inspect logs for redacted errors.

Operational events are emitted as structured JSON and redact credential fields, tokens, and complete PostgreSQL URLs.
