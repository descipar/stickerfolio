# Application architecture

Stickerfolio is a modular monolith. It is deployed as one application, while domain modules own their use cases and persistence concerns behind explicit public APIs. This keeps the initial operation simple without turning the codebase into one inseparable layer.

## Module dependency graph

```text
identity       -> none
collectors     -> identity
catalog        -> none
collections    -> collectors, catalog
trading        -> collectors, catalog, collections
admin          -> identity, collectors, catalog
```

Each module exposes its public API through `src/modules/<module>/index.ts`. A module may import only the public index of an allowed dependency. Imports into another module's internal files are always forbidden.

The `app` and `components` layers may call module public APIs, but they may not access PostgreSQL directly. Database queries and domain decisions belong behind module use cases rather than in pages, route handlers, or visual components.

These rules are enforced by ESLint and by executable boundary tests. Update the dependency graph and its enforcement together when a genuine product dependency is introduced.

## Infrastructure

PostgreSQL access is asynchronous and uses a bounded `pg` pool. Development reuses a pool through `globalThis` so Next.js hot reloads do not create unbounded connections. Application queries use parameter arrays and the shared query helper. Multi-statement changes use the transaction helper.

Schema changes are forward migrations in the repository's `migrations` directory. The production migration runner uses an advisory lock, validates migration order, and executes pending migrations transactionally. The same runner is used by local commands, automated tests, and deployments.

## Catalog revisions and holdings

An album is a logical catalog. Stable sticker identities belong to that album, while codes, labels, ordering, and section membership belong to a numbered revision. A published revision is structurally immutable; corrections that change structure require a new revision. Existing personal collections remain pinned to their original revision, while new collections select the current published revision.

Holdings are sparse. No row means quantity zero, and only quantities from 1 through 99 are stored. Composite foreign keys guarantee that a holding's sticker belongs to the exact revision selected by its collection. A partial unique index permits at most one active collection per collector and logical album.

## Read-only collection sharing

Revocable list sharing belongs to the `collections` module because it exposes a
strict projection of one personal collection. Owner operations derive the
collector exclusively from the authenticated session. Public reads begin with
one opaque capability token, compare only its SHA-256 hash, and return no
internal user, collector, collection, revision, section, or sticker IDs.

Share links store their selected scope, optional expiration, and revocation
state. Missing and duplicate rows are derived from current holdings on every
request, so a link remains live without copying or denormalizing private
collection data. The HTTP and visual layers call the module's public API and do
not query the share table directly.

## Direct collection comparison

Short-lived comparison grants belong to the `trading` module. They reuse the
capability lifecycle pattern from collection sharing but remain a distinct
authenticated authority: a grant permits only a derived comparison against one
compatible collection owned by the signed-in recipient. It never exposes a
complete shared list and does not depend on either collector's general trading
visibility preference.

The QR token and manual fallback code are independently generated and stored
only as SHA-256 hashes. The comparison query joins the two pinned revisions by
stable sticker identity inside a repeatable-read transaction, derives current
missing/duplicate directions locally, and returns only display name,
revision-specific codes, sections, and spare counts relevant to the exchange.
