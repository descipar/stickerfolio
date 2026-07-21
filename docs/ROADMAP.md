# Stickerfolio – Product and Architecture Roadmap

Status: Draft with confirmed Phase 0 decisions
Last updated: July 18, 2026

## 1. Purpose of this document

This document describes the greenfield rewrite of Stickerfolio as a portable multi-user application. It combines the product feature roadmap with the architecture decisions required to implement it.

The roadmap is intentionally independent of any particular hosting provider. Stickerfolio must run on a Raspberry Pi, a self-managed server, or a cloud provider without making product features depend on proprietary services.

The existing application will not be refactored or migrated incrementally. It is only a reference for proven domain workflows, verified album data, and desired interaction patterns. The new application code, data model, persistence layer, authentication, and deployment are designed from scratch.

This document includes the product plan, technical review results, and Phase 0 decisions. It is the single planning source for the rewrite. Remaining implementation details will be resolved in their respective phases.

## 2. Current state

Stickerfolio is currently a mobile, self-hosted Next.js application with these properties:

- Multiple collectors can be created and selected.
- A collector can manage multiple albums.
- Sticker holdings are quantity-based from `0` through `99`.
- `0` means missing, `1` means owned, and every additional copy is a duplicate.
- Missing, owned, and duplicate stickers can be searched and filtered.
- Progress is displayed globally and per album section.
- Additional albums can be imported from CSV files.
- Holdings can be exported as CSV or JSON.
- The interface is optimized for iPhone use.
- There are no user accounts, authentication, or permissions.
- The active collector is selected only through a browser cookie.
- Data is currently stored in SQLite.
- Prepared example holdings can be loaded explicitly through an optional seed script.

The existing source code is not the technical foundation of the rewrite. Only domain knowledge and verified source data are carried forward:

- Quantities from `0` through `99` have proven to be an understandable inventory model.
- Generic album sections work for teams, pages, and other categories.
- Mobile search, filters, and direct quantity changes are core workflows.
- The existing World Cup 2026 template and verified example holdings may be transferred into portable seed data.

The SQLite schema, synchronous data access, previous API contracts, cookie-based collector selection, and previous directory structure will not be retained. The new application therefore requires no compatibility layer for an architecture that predates user accounts and a shared catalog.

## 3. Product goal

Stickerfolio will become a mobile web application in which multiple registered users independently manage sticker albums and discover potential trade partners.

The first multi-user release will provide at least the following:

1. Users can sign in.
2. New users can self-register when allowed by system configuration.
3. Administrators can manage users and album templates.
4. A new user can choose a predefined album during onboarding.
5. A user can collect multiple albums at the same time.
6. The application can show which collectors own required duplicates and which of the current user's duplicates those collectors need.
7. Initial trade matching is informational only and never changes holdings.

Binding trade requests, reservations, and in-app messages may be added later.

## 4. Constraints and assumptions

### 4.1 Expected usage

- The initial target is at most approximately 50 concurrently active users.
- The total number of registered users may be higher.
- Typical usage consists of many reads and short holding updates.
- A holding update usually affects exactly one sticker.
- Offline operation is not required.
- Smartphone usability, especially on an iPhone 13, remains a core requirement.

### 4.2 Operation

- Docker Compose is the default deployment method.
- The application and PostgreSQL start together by default.
- An external PostgreSQL database can be connected through a database URL.
- The app container is stateless.
- Important user data must never be part of the Docker image.
- Domain seeds for albums, collector profiles, and holdings never run automatically at container startup.
- The existing SQLite database does not need to be migrated.
- Backward compatibility with previous API routes or database tables is not guaranteed.
- The first multi-user MVP runs as exactly one app instance.

### 4.3 Provider independence

Product features must not require a specific cloud provider. In particular:

- no mandatory proprietary authentication service,
- no mandatory proprietary database,
- no mandatory proprietary messaging service,
- no indispensable data stored only in a provider-specific format,
- standardized environment-variable configuration,
- portable backups and documented recovery.

Provider-specific services may later be added through optional adapters. The core application must remain fully functional without them.

## 5. Architecture decision

### 5.1 Modular monolith

Stickerfolio will be rebuilt as a modular monolith. UI, application logic, and HTTP interfaces live in one Next.js application and ship as one Docker image.

Code is separated into domain modules:

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

Module boundaries are domain boundaries, not deployment boundaries. No separate services or deployments are introduced initially.

The boundaries are enforced technically. Public exports per module and ESLint rules such as `no-restricted-imports` prevent access to another module's internal files. The HTTP layer may call application use cases but contains no database or domain logic itself.

#### Rationale

A modular monolith provides the best balance of clarity, operational safety, and extensibility for the expected scale:

- One image and process are easier to build, test, back up, and update.
- Domain boundaries still prevent uncontrolled mixing of identity, album, and trading logic.
- Transactions between holdings and future trade reservations remain straightforward.
- Approximately 50 concurrent users do not justify microservices.
- A module can be extracted later if a concrete scaling or operational need appears.

Microservices would add network interfaces, distributed failure modes, multiple deployments, and more complex observability without corresponding product value.

### 5.2 PostgreSQL as the only database

The target architecture uses PostgreSQL exclusively. The rewrite includes neither SQLite support nor `better-sqlite3`.

#### Rationale

- PostgreSQL handles concurrent reads and writes reliably.
- Accounts, sessions, holdings, and future trade actions can be processed consistently in transactions.
- Relational queries and indexes fit trade-partner matching well.
- PostgreSQL can run locally, on Raspberry Pi, on a self-managed server, or externally.
- `pg_dump` and `pg_restore` provide portable backup and recovery.
- Supporting one database reduces development, migration, and testing effort.
- Removing the native SQLite module simplifies ARM Docker builds.

PostgreSQL does not tie Stickerfolio to a cloud provider. It is the standardized runtime dependency regardless of who operates the database process.

### 5.3 Stateless app container

The app container stores no indispensable data in its filesystem or memory. Accounts, sessions, collections, and holdings live in PostgreSQL. The only deliberate MVP exception is a short-lived, per-process rate limiter for login and registration.

#### Rationale

- The container can be replaced safely during updates.
- The same image can run locally or externally.
- Backups are independent of container lifetime.
- Multiple app instances remain possible later, but will require a shared rate-limit store.

## 6. Deployment model

### 6.1 Default: PostgreSQL in Docker Compose

The default configuration contains at least:

```text
Docker Compose
├── app
├── migrate
└── postgres
    └── postgres-data
```

- `app` contains the Next.js application.
- `migrate` applies pending schema changes before the app starts.
- `postgres` provides the database.
- `postgres-data` is a persistent Docker volume.
- PostgreSQL is not published on a host port by default.
- The application is exposed on configured host port `3500`.

The standard start remains simple:

```bash
docker compose up -d --build
```

### 6.2 Alternative: external PostgreSQL

The same app build is used with an external database. The connection is configured only through an environment variable:

```env
DATABASE_URL=postgresql://user:password@database.example:5432/stickerfolio
```

A separate `compose.external-db.yaml` or an equivalent documented app-only start prevents an unused local PostgreSQL container from starting. A Compose profile alone is not assumed to disable otherwise active services.

Both deployment variants use:

- the same data model,
- the same migrations,
- the same seeds,
- the same Docker image,
- the same backup and restore format.

### 6.3 Configuration and secrets

Configuration is supplied through environment variables. Secrets are never committed to Git. At minimum, configuration includes:

- `DATABASE_URL`,
- a secure session secret,
- the public application base URL,
- registration mode,
- optional SMTP settings,
- optional TLS settings for external databases.

Example files contain placeholders and safe local defaults only.

## 7. Data model

### 7.1 Users and collector profiles

User accounts and collector profiles are modeled separately.

A user account includes, for example:

- unique ID,
- email as the only login identity,
- role,
- account status,
- whether the initial password must be changed,
- creation and modification timestamps.

The visible display name belongs to the collector profile and cannot be used to sign in.

Better Auth owns the authentication-related core records in PostgreSQL:

- user identity and normalized email,
- `account` records containing credential password hashes,
- `session` records for server-side revocable sessions,
- generic `verification` records for later one-time operations such as password reset.

Stickerfolio additionally owns `invitations` for invitation-based registration. Invitations are single-use, expire, and are never stored in plaintext. Email verification is disabled in the MVP, while Better Auth's verification model remains available for later email verification or password reset.

When an administrator creates an account, the administrator directly supplies an initial password. It uses the same Better Auth and Argon2id path as any other password, is stored only as a hash, and is never shown again. This flow has no activation link. The password is communicated outside Stickerfolio. An administrator may set a new password later but can never read the previous one.

A completely fresh installation automatically creates exactly one administrator account on first startup:

- email: `admin@stickerfolio.local`,
- initial password: `admin123!`,
- role: `admin`,
- `must_change_password = true`,
- no collector profile or collection.

The bootstrap runs only while the user table is empty and never resets an existing administrator. Until the password is changed, the session may access only the password-change page and logout.

A collector profile includes, for example:

- visible display name,
- user-account association,
- visibility settings,
- participation in trade matching,
- optional contact-sharing settings.

In the first release, a normal user owns exactly one collector profile. The separation still allows administrators without a collector profile and possible shared profiles later.

### 7.2 Roles

Two roles are sufficient initially:

- `user`: manages the user's own profile, collections, and holdings,
- `admin`: additionally manages users, system settings, and album templates.

Authorization is checked server-side for every protected use case. Hiding a UI control is not access control.

### 7.3 Shared album catalog and template revisions

Album templates and personal collections are distinct.

A logical album contains:

- name and unique key,
- description,
- optional publisher, release year, and cover,
- album-wide stable sticker identities,
- one or more numbered template revisions.

A template revision contains:

- a state such as `draft`, `published`, or `archived`,
- ordered sections such as teams, pages, or categories,
- a complete mapping of included stable sticker IDs to codes and sections.

The World Cup 2026 album exists once as a shared logical album. Every collector owns a separate personal collection referencing one concrete published revision.

#### Rationale

A shared catalog is required for reliable trade matching. All revisions use the same stable identity for the same physical sticker, so the application need not reconcile similar codes or independently imported album copies. A revision defines the currently valid code, section, and scope without silently changing existing collections.

### 7.4 Personal collections and holdings

A personal collection links a collector profile to a concrete template revision. A collector may have at most one active collection per logical album.

The domain quantity remains:

- `quantity = 0`: missing,
- `quantity = 1`: owned,
- `quantity > 1`: owned, with `quantity - 1` duplicates.

PostgreSQL stores holding rows only for owned stickers:

- no `holdings` row: domain quantity `0`,
- `holdings.quantity = 1`: owned,
- `holdings.quantity > 1`: owned with duplicates.

The API and UI still expose missing stickers as quantity `0`. Values range through `99`. Setting a quantity to `0` deletes the row; increasing it from `0` creates one.

#### Rationale

A new collection needs no row for every sticker in its revision. Any included sticker without a row is missing. Stickers introduced by a later revision are not automatically added to or considered missing from an existing collection.

### 7.5 Proposed core relationships

```text
Better Auth
├── user
│   ├── account
│   ├── session
│   └── collector_profile
│       ├── collections
│       │   ├── album
│       │   ├── album_template_revision
│       │   └── holdings
│       └── trading_preferences
└── verification

Stickerfolio
├── albums
│   ├── stickers
│   └── album_template_revisions
│       ├── album_sections
│       └── album_revision_stickers
└── invitations
    ├── created_by_user_id
    └── accepted_by_user_id (optional)
```

`collections` stores both logical album ID and concrete revision ID. A composite foreign key ensures the revision belongs to the album; uniqueness on collector profile and logical album prevents multiple active collections of the same album. `holdings` references the album-wide stable sticker ID. Database or application consistency checks ensure that a holding refers only to a sticker included in the collection revision.

Later binding trade workflows may add:

```text
trade_requests
trade_request_items
trade_reservations
trade_messages
```

These tables are outside the initial read-only trade-partner view.

## 8. Feature roadmap

### 8.1 Login and sessions

Users sign in and out with email and password. Better Auth runs as a library inside the Next.js application and requires no separate auth server or proprietary cloud service.

Better Auth provides email/password authentication and database-backed sessions. Sessions are stored server-side in PostgreSQL and referenced through cookies unavailable to JavaScript. App-container restarts therefore do not unintentionally end valid sessions.

Requirements:

- Argon2id password hashes with parameters tested on Raspberry Pi,
- protection for pages and API endpoints,
- session expiry and revocation,
- logout on the current device,
- optional logout on all devices later,
- secure cookie settings appropriate to HTTPS and environment,
- no proprietary authentication provider as a prerequisite.

Better Auth receives custom Argon2id hash and verify functions. Parameters are benchmarked so that parallel login remains usable on Raspberry Pi 4 without unnecessarily weakening security.

#### Rationale

The previous collector cookie represented a selection, not authenticated identity. Once the application can be publicly reachable, every access to personal holdings must belong to a verified user account.

### 8.2 Administrator

Administrators receive a protected management area. On a fresh installation, the operator signs in as `admin@stickerfolio.local` with `admin123!` and must immediately set a new password before accessing it.

Planned capabilities:

- list users,
- create a user with email and initial password,
- set a new password without reading the old one,
- activate or suspend accounts,
- manage roles,
- configure registration mode,
- create, import, validate, and publish album templates,
- view system status and version information.

Administrators deliberately have no access to another user's holdings or trade data. They manage accounts, roles, registration, system settings, and album templates only. A negative authorization test enforces this boundary.

Deleting a user requires explicit confirmation and a defined policy for associated collection data.

### 8.3 Registration

Three entry paths are supported:

- an administrator sends an invitation link,
- users self-register when open registration is enabled,
- an administrator creates an account directly.

For direct creation, the administrator enters email, display name, and an initial password. The password is immediately hashed with Argon2id, never stored or shown in plaintext, and communicated outside the application. No activation link is introduced for this path.

Operational requirements include:

- unique email as login identity,
- server-side validation,
- rate limiting, especially for open registration,
- optional future password reset through a replaceable SMTP adapter.

Email verification is not part of the MVP. Therefore open registration in a publicly reachable deployment may be enabled only when Better Auth email verification is also enabled. Without verification, invitation and administrator-created accounts remain the safe methods.

Future password reset uses persistent, expiring Better Auth verification records. SMTP only transports the message and does not own the account or token state.

### 8.4 Initial onboarding and album selection

After registration or first login, a new user follows a short flow:

1. Set or confirm the display name.
2. Select one or more available album templates.
3. Create empty personal collections.
4. Continue directly to the first album view.

The World Cup 2026 album is the first predefined template. Users may add or remove other albums later without recreating their account.

### 8.5 Album catalog and templates

Users see a catalog of available templates. Administrators manage its contents.

Planned properties:

- album name, description, and optional cover,
- sticker and section counts,
- numbered revisions in draft, published, or archived state,
- import from a documented portable format,
- validation of duplicate or invalid codes,
- no automatic changes to personal holdings during import.

Only administrators may import templates. This protects the shared stable sticker identities used by trade matching.

A published revision is structurally immutable: stable sticker mappings, codes, scope, and section assignments are not overwritten. Purely descriptive metadata may be corrected with an audit trail.

Changing a code, adding or removing a sticker, or changing a section assignment creates a new revision. The previous revision is archived but remains available to existing collections. New collections use the current published revision. Existing collections are not migrated automatically in the MVP.

### 8.6 Automatic potential trade-partner view

For one selected album, the application lists other participating collectors with possible matches.

Collector A can receive a sticker from collector B when:

- A has no holding row and therefore domain quantity `0`,
- B has `quantity > 1` for the same album-wide stable sticker ID,
- the sticker is included in both collection revisions.

Different revisions of the same logical album can therefore match through stable sticker IDs. The UI shows the code valid for each collection. Different logical albums never match.

A two-way match additionally requires at least one sticker that B needs and A owns in duplicate.

The view includes at least:

- the potential partner,
- stickers the current user could receive,
- stickers the other collector could use,
- one-way and two-way match counts,
- album and optional section filters,
- deterministic sorting.

The first version is read-only:

- no automatic holding changes,
- no reservation,
- no trade request,
- no message,
- no automatically asserted completion.

#### Privacy and visibility

Participation is opt-in. New profiles remain hidden until the user enables `trading_preferences.visible`. Only opted-in collectors are considered. The application shows display name and matching sticker information, never the login email. An explicitly shared contact method may be added later.

### 8.7 Later extension: trade requests and messages

After the read-only view is established, the trading module may add:

- selecting concrete stickers for a proposal,
- sending, accepting, rejecting, or changing a request,
- reserving offered duplicates,
- states such as requested, agreed, completed, and cancelled,
- messages within a trade,
- controlled holding updates after completion.

These structures will be designed only after the domain workflow is agreed.

## 9. Mobile usability

Mobile UI is a first-class quality goal, not merely a smaller desktop layout.

Requirements:

- comfortably reachable controls,
- no hover-only interactions,
- readable layout on iPhone 13,
- fast search by code, team, or section,
- direct quantity changes through large plus and minus buttons,
- clear loading, success, and error states,
- installable web app from the home screen,
- no offline synchronization requirement.

Trade matching uses compact summaries and expandable details so long lists remain manageable on small screens.

## 10. Security and privacy

### 10.1 Access control

- Every mutation is associated server-side with the authenticated user.
- IDs from URLs or requests never grant access to another user's collections.
- Admin endpoints verify role independently of the UI.
- Passwords are never stored or logged in plaintext.
- Sessions expire and can be revoked.

### 10.2 Protection of public endpoints

- Limit repeated login and registration attempts.
- Validate input server-side.
- Use `SameSite=Lax` cookies and server-side Origin checks as the MVP CSRF baseline.
- Send secure HTTP headers.
- Limit import request sizes.
- Avoid sensitive information in errors.

The single-instance MVP may keep login and registration limits in process memory. This state is not a persistent security record and is never used for sessions. A shared store is required before multiple app instances are supported.

### 10.3 Privacy features

Minimum capabilities:

- users control collector-profile visibility,
- other collectors see only necessary data,
- users can export their collection data,
- account deletion and retention have a defined workflow,
- administrative and security-sensitive actions are auditable.

Legal text and concrete retention periods depend on the eventual public offering and must be reviewed before public production use.

## 11. Schema migrations, seeds, and initialization

### 11.1 No migration of the existing SQLite database

The existing SQLite database is not migrated to PostgreSQL. The rewrite starts with a new PostgreSQL schema and no domain data.

### 11.2 Versioned schema migrations

Database changes are versioned from the beginning, for example:

```text
migrations/
├── 0001_initial.sql
├── 0002_identity.sql
├── 0003_album_catalog.sql
└── 0004_trading_preferences.sql
```

Migrations change schema and run in a controlled step before a new app version. They remain separate from seeds.

`node-pg-migrate` is the only production migration tool, including for Better Auth tables. Better Auth may describe or generate its schema for review but must not independently mutate the production database. Better Auth schema changes are reviewed and represented as project migrations.

### 11.3 Asynchronous PostgreSQL access

The persistence layer is asynchronous from the start and uses one shared pool plus a transaction helper:

```text
withTransaction(async client => {
  // BEGIN, domain operations, COMMIT
  // ROLLBACK on failure
})
```

There is exactly one pool per production app instance. In Next.js development, it is stabilized through `globalThis` so hot reload does not create extra pools.

### 11.4 One-time first-admin bootstrap

After successful migrations, startup checks whether any user exists. Only an empty user table triggers creation through Better Auth of `admin@stickerfolio.local`, role `admin`, and initial password `admin123!`. The password is immediately hashed with the selected Argon2id configuration.

The bootstrap must:

- never run once any user exists,
- never reset or overwrite existing credentials,
- set `must_change_password = true`,
- block protected domain functions before the password changes,
- create no collector profile, album, or holding,
- log a clear status without logging secrets.

This technical access bootstrap is not a domain seed. Album, collector, and holding data remain explicitly loaded only.

### 11.5 Explicit seeds

Seeds deliberately create domain starting data and never run automatically at container startup.

Available seeds:

- Bundled catalog seed: creates the reviewed World Cup 2026 and EURO 2024 shared templates, sections, and stickers.
- Individual catalog seeds: load either bundled catalog independently.
- Example holdings seed: attaches prepared sample holdings to an explicitly selected account or collector profile already created in the app.

Seed requirements:

- explicit manual invocation,
- idempotent behavior,
- no accidental overwrite of existing holdings,
- understandable output,
- unambiguous target selection,
- never create a password or user account,
- identical flow with bundled and external PostgreSQL.

The exact command syntax will be defined during implementation and documented in the README.

## 12. Performance and scaling target

The initial target is approximately 50 concurrently active users. Horizontal scaling is not required but should not be needlessly prevented.

### 12.1 Database connections

The app uses a bounded PostgreSQL pool shared by web requests. It does not reserve a permanent connection per user.

The initial pool size is conservative and configurable. Load testing, not the number of registered users alone, determines the final value.

### 12.2 Indexes

Indexes are required for at least:

- collections by collector,
- holdings by collection,
- holdings for one sticker across collectors,
- duplicates with `quantity > 1`,
- active sessions by user,
- visible trade participants.

There is no partial index for `quantity = 0` because missing stickers have no holding rows. Missing stickers are found through an anti-join between the revision catalog and holdings. Duplicates use a narrow partial index for `quantity > 1`. Exact index order follows real queries and `EXPLAIN ANALYZE`.

### 12.3 Load test

Before public production use, at least this scenario is tested:

- 50 concurrent authenticated users,
- concurrent album views,
- parallel quantity updates,
- parallel trade matching,
- registration and login under load,
- slow or temporarily unavailable database behavior.

The objective is stable operation for expected use, not an artificial headline benchmark.

## 13. Backup and recovery

Backups use standard PostgreSQL tools:

- `pg_dump` for backup,
- `pg_restore` for recovery,
- documented commands for bundled and external databases,
- regular verification that a backup can actually be restored.

Backups must be stored outside the database container. A Docker volume alone is not a complete backup.

The admin area may later trigger and download backups, but technical backup remains usable independently of the UI.

## 14. Observability and operation

The application provides at least:

- a simple liveness endpoint,
- a readiness endpoint with database check,
- structured logs on standard output,
- clear errors for missing configuration,
- no passwords, tokens, or complete database URLs in output,
- visible app and schema versions for administrators.

No proprietary monitoring platform is required. Operators may monitor standard output and HTTP endpoints with tools of their choice.

## 15. Quality assurance

Tests follow the new module boundaries from the beginning:

- unit tests for domain logic,
- PostgreSQL integration tests,
- authentication and authorization API tests,
- trade-matching tests,
- seed and migration tests,
- mobile UI tests for core workflows,
- Docker-image build in continuous integration.

Integration tests use Testcontainers and a real disposable PostgreSQL instance. Test setup applies the production migrations for both Stickerfolio and Better Auth. A database mock does not replace these tests.

Negative authorization tests are especially important: manipulated IDs must never allow a user to mutate foreign holdings or view hidden trade information.

## 16. Implementation phases

### Phase 0 – Review and decisions

- Review the roadmap from product and technical perspectives. ✓
- Resolve open decisions and record them here. ✓
- Select `node-pg-migrate`. ✓
- Select Testcontainers for PostgreSQL integration tests. ✓
- Select Better Auth with email/password, Argon2id, and PostgreSQL sessions. ✓
- Create GitHub issues for confirmed work packages. ✓
- Add acceptance criteria to each issue. ✓

Outcome: approved target architecture and a prioritized work backlog.

### Phase 1 – Greenfield foundation and PostgreSQL

- set up the new Next.js project and domain modules,
- enforce module boundaries through lint rules,
- design the PostgreSQL model from scratch,
- implement asynchronous persistence, pool singleton, and transaction helper,
- introduce versioned migrations,
- include Better Auth schema in `node-pg-migrate`,
- create default Compose deployment,
- document external-database deployment,
- establish real PostgreSQL CI tests,
- add health and readiness endpoints,
- document backup and restore commands.

Outcome: the new foundation runs entirely on PostgreSQL with no production SQLite or legacy compatibility path.

### Phase 2 – Shared album catalog and seeds

- separate templates from personal collections,
- model logical albums, immutable revisions, and concrete collection revisions,
- provide reviewed World Cup 2026 and EURO 2024 catalog seeds,
- transfer verified source data into the new seed format,
- provide an optional example holdings seed for an existing account,
- create new collections from templates,
- store holdings only above quantity `0`,
- allow multiple albums per collector,
- adapt import validation to the revision model.

Outcome: multiple collectors independently collect the same shared template.

### Phase 3 – Users, login, and roles

- implement accounts and secure password storage,
- integrate Better Auth and PostgreSQL sessions,
- benchmark Argon2id on Raspberry Pi,
- implement the one-time first admin and mandatory change of `admin123!`,
- protect routes and use revocable sessions,
- link users and collector profiles,
- add `user` and `admin` roles,
- provide login, logout, and session management,
- derive collection access exclusively from authenticated context.

Outcome: every access is associated with an authenticated user.

### Phase 4 – Administration and registration

- implement the admin area,
- allow admins to create accounts with initial passwords,
- manage account status and roles,
- support configurable self-registration,
- add invitation links,
- add short-lived login and registration rate limits,
- persist invitation tokens; no MVP email verification,
- prepare optional later Better Auth password reset,
- implement onboarding and predefined album selection,
- manage and archive published album revisions.

Outcome: new users can be admitted in a controlled way and start collecting independently.

### Phase 5 – Potential trade-partner view

- add participation and visibility settings,
- query one-way and two-way matches,
- implement a mobile partner overview,
- show offered and needed sticker details,
- add sorting and filters,
- add authorization and privacy tests,
- load-test approximately 50 concurrent users.

Outcome: users see possible partners without changing holdings or trade state.

### Phase 6 – Later binding trade actions

- agree the domain workflow,
- trade requests,
- reservations,
- status model,
- in-app messages,
- controlled completion and holding changes.

This phase is explicitly outside the first multi-user MVP.

## 17. Explicit non-goals of the first multi-user MVP

- offline operation and later synchronization,
- native iOS or Android app,
- microservices,
- multiple horizontally scaled app instances,
- social feeds or public comments,
- payment system,
- automated shipping or payment processing,
- in-app messages,
- automatic holding updates from a proposed trade,
- migration of the existing SQLite database,
- compatibility with previous API routes,
- mandatory integration with any cloud provider.

These features are not rejected permanently; they are deferred until there is a concrete need and agreed workflow.

## 18. Risks and mitigations

### Risk: album templates change after publication

A correction could affect existing collections.

Mitigation: published revisions freeze sticker mappings, codes, scope, and section assignment. Structural changes create a new revision, while existing collections remain on the previous one. Only non-identity metadata may be corrected with an audit trail.

### Risk: trade queries expose too much data

A technically correct query could still reveal unwanted information about foreign holdings.

Mitigation: explicit opt-in, server-side visibility rules, minimal response data, and negative tests for hidden profiles.

### Risk: registration abuse

A publicly reachable form can be automated.

Mitigation: configurable registration mode, rate limiting, and email verification when open registration is publicly exposed.

### Risk: known bootstrap administrator password

Anyone can use the documented `admin123!` until the operator changes it.

Mitigation: create the account only for an empty installation and mark it `must_change_password = true`. Before the change, only password change and logout are available. Startup explicitly demands immediate replacement. Bootstrap never resets an existing administrator.

### Risk: a seed overwrites real holdings

Repeated seed execution could alter production data.

Mitigation: idempotent seeds, explicit target selection, no automatic execution, and no overwrite of existing quantities by default.

### Risk: database operation is underestimated

A persistent volume does not protect against operator error, hardware failure, or corruption.

Mitigation: automatable dumps, external retention, and regularly tested recovery.

### Risk: module boundaries exist only on paper

New directories alone do not prevent tight coupling.

Mitigation: keep HTTP handlers thin, place use cases in modules, restrict data access to responsible repositories, and enforce import boundaries in CI.

### Risk: development creates too many database connections

Next.js hot reload may repeatedly load modules and create pools.

Mitigation: exactly one pool per app instance and a `globalThis`-stabilized singleton in development.

### Risk: in-memory rate limiting is mistaken for scalable protection

Per-process state disappears on restart and cannot coordinate instances.

Mitigation: document one app instance as an MVP boundary and require a shared rate-limit store before horizontal scaling.

## 19. Multi-user MVP acceptance criteria

The multi-user MVP is complete when:

1. Stickerfolio uses PostgreSQL exclusively.
2. Documented Docker Compose operation with app and PostgreSQL works.
3. External PostgreSQL can be configured as an alternative.
4. A fresh installation starts without collector or album data and with exactly one first-admin account restricted until its password changes.
5. Bundled catalogs and optional example holdings load only through explicit seeds.
6. Users can register, sign in, and sign out.
7. An administrator can manage users and album templates.
8. A new user can select a predefined album during onboarding.
9. A user can manage multiple albums.
10. Holding quantities from `0` through `99` work correctly.
11. Users cannot mutate foreign holdings.
12. Participating users can see potential partners for the same album.
13. Hidden collector data never appears in trade matching.
14. Trade matching never changes holdings.
15. Core workflows are usable at iPhone 13 size.
16. A load test with approximately 50 concurrent users passes without domain errors.
17. PostgreSQL backup and restore are documented and tested.
18. Production code contains no SQLite dependency or legacy compatibility layer.
19. Sessions survive app restart and can be revoked server-side.
20. Integration tests run against real PostgreSQL.
21. The bootstrap admin is created only for an empty user table, must change `admin123!` before any domain function, and is never reset on later starts.

## 20. Confirmed decisions

1. **Login identity:** email only; display name is separate and cannot sign in.
2. **Registration:** invitation, open self-registration, and admin-created accounts; admins set initial passwords directly without activation links.
3. **Email verification:** not in the MVP.
4. **Admin visibility:** no access to foreign holdings; accounts, roles, settings, and catalogs only.
5. **Trade-profile visibility:** opt-in and hidden by default.
6. **Visible profile data:** display name and matching stickers only; never login email.
7. **Template import:** administrators only.
8. **Template corrections:** published revisions are structurally frozen; structural corrections create a new revision, while audited metadata corrections are allowed.
9. **Migration tool:** `node-pg-migrate`.
10. **PostgreSQL integration tests:** Testcontainers.
11. **Authentication:** Better Auth with email/password, custom Argon2id functions, and revocable PostgreSQL sessions.
12. **Backup:** a relaxed RPO is acceptable; periodic externally stored `pg_dump` plus occasional tested restore is sufficient.
13. **Response targets:** album view p95 below 400 ms, trade matching p95 below 1 second, quantity update p95 below 200 ms at approximately 50 concurrent users.
14. **First administrator:** an empty installation creates `admin@stickerfolio.local` with `admin123!` exactly once and requires a password change before further use.

## 21. Recommendation summary

Stickerfolio is rebuilt completely as a modular, portable Next.js monolith. The previous code is a domain reference only. PostgreSQL is the only database and runs with the app in Docker Compose by default, while external PostgreSQL remains supported without product changes. Users, collector profiles, shared catalog, personal collections, and holdings are clearly separated.

Multi-user capabilities are introduced in controlled phases: PostgreSQL and catalog first; then authentication, roles, registration, and onboarding; then the read-only potential trade-partner view. Binding trade requests and in-app messages remain later extensions.

This approach is appropriate for approximately 50 concurrently active users, avoids unnecessary distributed systems, and preserves deployment portability.
