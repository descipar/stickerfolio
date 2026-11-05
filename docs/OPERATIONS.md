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
- `GET /api/health/ready` verifies PostgreSQL connectivity and compares the
  applied migrations with the list compiled into the running build
  (`src/infrastructure/database/schema-manifest.ts`):
  - `schemaState: "current"`: exactly the expected migrations; HTTP 200.
  - `schemaState: "behind"`: at least one expected migration is missing, for
    example when the app was started without the migrate service. HTTP 503 with
    `status: "not_ready"`; run `pnpm db:migrate`.
  - `schemaState: "ahead"`: all expected migrations plus newer ones. HTTP 200.
    This is the rollback case: a previous image on a newer, forward-compatible
    schema keeps serving. A destructive migration must not be rolled back this
    way; restore the pre-update dump instead.
- `GET /api/version` reports application and schema versions for diagnostics.

These responses are not cached. Inspect Compose state and recent logs with:

```bash
docker compose ps
docker compose logs --tail 100 migrate app
curl --fail http://localhost:3500/api/health/live
curl --fail http://localhost:3500/api/health/ready
curl --fail http://localhost:3500/api/version
```

## Logs and audit trail

The application writes one JSON object per line to stdout. Sensitive keys
(passwords, tokens, cookies, email addresses, holdings, connection strings) are
redacted before writing.

- `level: "error"`, `event: "api.unexpected_error"`: an API request failed for
  an unexpected reason. The line contains the redacted error and the route with
  identifiers replaced (`PUT /api/collections/:id/holdings/:id`). The client
  only receives a generic 500.
- `event: "security.audit"`: a security-relevant action. `audit.action` is one
  of: account created, email changed, exported, password changed or reset, role
  or status changed, deactivated or deleted; failed or throttled sign-in;
  album revision published or archived; share link created, updated or
  revoked; comparison grant created, redeemed or revoked; invitation created
  or revoked; registration mode configured. Events carry actor and target ids,
  never email addresses, passwords, or holdings. Failed sign-ins are keyed by
  a keyed hash (HMAC with `BETTER_AUTH_SECRET`) of the normalized address, so
  attempts against one account can be correlated without storing it.

Decision: audit events stay in the log stream rather than a database table.
That keeps them out of account deletion and backups and needs no extra
retention job. Retention is therefore an operator responsibility:

- Both Compose files rotate the app container log with the `json-file`
  driver: `APP_LOG_MAX_SIZE` (default `20m`) times `APP_LOG_MAX_FILE`
  (default `10`) per container. Rotated-out lines are lost, and so is the log
  when the container is removed.
- To keep the audit trail longer, ship the container log to a separate store,
  for example a Docker logging driver (`journald`, `syslog`, `fluentd`,
  `gelf`) or a collector reading `docker compose logs`, and filter
  `event == "security.audit"`. A retention of 90 days to one year is typical
  for a small deployment. Delete older records according to your privacy
  policy, as they contain user ids.

Extract the audit trail from the local log:

```bash
docker compose logs --no-log-prefix app | grep '"security.audit"'
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

The external scripts apply the same TLS policy as the application
(`scripts/postgres-tls.sh`):

- `DATABASE_SSL_MODE` sets libpq's `PGSSLMODE`. Unlike libpq's `prefer`
  default, the scripts default to `verify-full`.
- For `verify-ca` and `verify-full`, `DATABASE_SSL_CA` is required. It is
  written to a temporary file in a private directory (mode `0700`), passed as
  `PGSSLROOTCERT`, and deleted when the script exits. Both real newlines and
  the escaped `
` form from env files are accepted.
- `require` and `disable` must be chosen explicitly and print a warning.
- `ssl*` parameters inside `DATABASE_URL` and inherited `PGSSL*` variables are
  rejected or cleared, so one unambiguous policy applies.

```bash
DATABASE_URL='postgresql://...' DATABASE_SSL_MODE=verify-full   DATABASE_SSL_CA="$(cat provider-ca.pem)"   ./scripts/postgres-backup.sh --external backups/stickerfolio.dump
```

A full dump contains password hashes, sessions, and every holding. Store it
encrypted and with restricted access.

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
