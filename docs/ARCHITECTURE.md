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
