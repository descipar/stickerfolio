# Application architecture

Stickerfolio is a modular monolith. It is deployed as one application, while domain modules own their use cases and persistence concerns behind explicit public APIs. This keeps the initial operation simple without turning the codebase into one inseparable layer.

## Module dependency graph

```text
identity       -> collectors
collectors     -> none
catalog        -> none
collections    -> collectors, catalog
trading        -> collectors, catalog, collections
admin          -> identity, collectors, catalog
accounts       -> identity, collectors, collections, trading
```

The graph lives in `src/modules/module-graph.json`. ESLint reads it to
enforce imports, and `test/module-data-ownership.test.ts` reads it to enforce
table ownership.

Each module exposes its public API through `src/modules/<module>/index.ts`. A module may import only the public index of an allowed dependency. Imports into another module's internal files are always forbidden.

The `app` and `components` layers may call module public APIs, but they may not access PostgreSQL directly. Database queries and domain decisions belong behind module use cases rather than in pages, route handlers, or visual components.

- `identity` owns accounts, credentials, sessions, and invitations. When it
  creates an account it asks `collectors` for the profile in the same
  transaction.
- `collectors` owns collector profiles and has no dependencies.
- `accounts` composes account-level use cases across modules, currently the
  portable account export.

## Principals instead of HTTP headers

Use cases take a `Principal` (`src/shared/principal.ts`): user id, role,
password-change state, collector id, session id, and scopes. They never read
headers, cookies, or tokens. The delivery layer resolves the principal:

- `src/auth/better-auth.ts` configures Better Auth (sign-in, sign-out,
  session lookup).
- `src/auth/principal.ts` is the cookie-session adapter. It turns a session
  into a principal (only for active accounts) and gives pages a `Viewer` with
  the collector profile.
- Route handlers call `principalOf(request)`; pages call `resolveViewer`.

A future adapter, for example OAuth bearer tokens for MCP (#75) or a
background job acting for a user, builds the same principal and calls the
same use cases. Cookie sessions carry the scope `*`; narrower adapters list
scopes such as `collections:read`, which `requirePrincipal` and
`requireCollectorPrincipal` check. ESLint forbids modules to import
`better-auth`, `@/auth`, `next/headers`, or `next/server`, and a test fails
if a module mentions `Headers`.

## Data ownership

Every table belongs to exactly one module (`tables` in `module-graph.json`):

| Module | Tables |
| --- | --- |
| identity | `user`, `session`, `account`, `verification`, `invitations` |
| collectors | `collector_profiles`, view `active_collector_profiles` |
| catalog | `albums`, `album_revisions`, `album_sections`, `album_revision_stickers`, `stickers`, `album_metadata_corrections` |
| collections | `collections`, `holdings`, `collection_share_links` |
| trading | `trading_preferences`, `collection_comparison_grants` |

Rules, enforced by `test/module-data-ownership.test.ts`:

1. Only the owner writes a table (`INSERT`, `UPDATE`, `DELETE`, row locks).
   Other modules call the owner's API, for example `admin` uses identity's
   `setAccountStatus` and collectors' `createCollectorProfileForUser`.
2. A module may read a foreign table in its own SQL only if it depends on the
   owner and lists the table under `reads`. These joins are deliberate:
   trade matching and comparisons run as single PostgreSQL statements over
   catalog, collections, and collector data (#117), which an API round trip
   per table would undo.
3. Every table created by a migration must have an owner.

Per-collector data is exported module by module: identity
(`exportAccountRecord`), collectors (`exportCollectorProfile`), collections
(`exportCollectionsForCollector`), and trading
(`exportTradingDataForCollector`). `accounts` composes them in one
repeatable-read transaction. A new module that stores per-collector data adds
its own contribution there. Deletion relies on `ON DELETE CASCADE` from the
account row, so new per-collector tables must reference the collector profile
or account with a cascading foreign key.

## Infrastructure

PostgreSQL access is asynchronous and uses a bounded `pg` pool. Development reuses a pool through `globalThis` so Next.js hot reloads do not create unbounded connections. Application queries use parameter arrays and the shared query helper. Multi-statement changes use the transaction helper.

Schema changes are forward migrations in the repository's `migrations` directory. The production migration runner uses an advisory lock, validates migration order, and executes pending migrations transactionally. The same runner is used by local commands, automated tests, and deployments.

## Catalog revisions and holdings

An album is a logical catalog. Stable sticker identities belong to that album, while codes, labels, ordering, and section membership belong to a numbered revision. A published revision is structurally immutable; corrections that change structure require a new revision. Existing personal collections remain pinned to their original revision, while new collections select the current published revision.

Holdings are sparse. No row means quantity zero, and only quantities from 1 through 99 are stored. Composite foreign keys guarantee that a holding's sticker belongs to the exact revision selected by its collection. A partial unique index permits at most one active collection per collector and logical album.

Holding writes are serialized per collection: every change locks the
collection row (`FOR UPDATE`) and then reads the stored quantity. The holdings
API accepts two forms (#127):

- `{ "delta": n }` adds `n` to the stored value, clamped to 0..99. The album
  view's +/- buttons use it, so taps on two devices both count.
- `{ "quantity": q, "expectedQuantity": e }` sets an absolute value only if
  the stored value is still `e`; otherwise it answers `409` with the current
  quantity. Typed values in the album view use it. Without
  `expectedQuantity`, the write is unconditional (seeds, scripts).

All writes go through one function that also asks for the lowest permitted
quantity. It is always 0 today. Trade reservations (#97) will return the
reserved copies there, inside the same transaction and lock, so no write can
drop a quantity below what an active proposal has reserved.

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

## Automatic trade matching

Partner discovery belongs to the `trading` module and is read-only. It handles
each request with two statements:

1. A partner-summary statement. It counts, for every trading-visible partner
   with the same logical album, the stickers that partner can offer and the
   stickers that partner needs. Offers are the partner's spare copies of
   stickers the owner is missing. Needs are the owner's duplicates that exist in
   the partner's pinned revision and that the partner does not hold. Direction
   filtering, sorting (display names use the ICU root collation `und-x-icu`),
   counting and `LIMIT/OFFSET` all run in PostgreSQL, and only the requested
   page of summaries is returned.
2. A detail statement. It loads sticker lines only for the partners on that
   page.

Both statements share the same candidate definition, so summary counts and
detail lines cannot diverge. Work in Node.js is bounded by the page size rather
than by the number of collectors. Measurements are recorded in
`load-test/results/trade-matching.md`.

## Direct collection comparison

Short-lived comparison grants belong to the `trading` module. They reuse the
capability lifecycle pattern from collection sharing but remain a distinct
authenticated authority: a grant permits only a derived comparison against one
compatible collection owned by the signed-in recipient. It never exposes a
complete shared list and does not depend on either collector's general trading
visibility preference.

A grant is bound to its first recipient (#133). The first collector who opens
it with a compatible collection is stored as `recipient_collector_id` by a
conditional `UPDATE ... WHERE recipient_collector_id IS NULL`, so concurrent
first redemptions cannot both win. Every later setup or comparison checks that
the viewer is that recipient. Opening a code without a compatible album does
not bind it. The owner can still revoke a bound grant, redemption is audited,
and grant creation is rate-limited per session.

The QR token and manual fallback code are independently generated and stored
only as SHA-256 hashes. The comparison query joins the two pinned revisions by
stable sticker identity inside a repeatable-read transaction, derives current
missing/duplicate directions locally, and returns only display name,
revision-specific codes, sections, and spare counts relevant to the exchange.
