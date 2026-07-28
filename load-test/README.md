# Stickerfolio load test — 50 concurrent users

k6 load test for the multi-user MVP performance targets in
[`docs/ROADMAP.md`](../docs/ROADMAP.md) §4.1 and §12, implementing issue #43.

It simulates ~50 concurrent authenticated collectors exercising the four core
operations (login, album view, quantity change, trade matching) against a
running Stickerfolio instance, with a realistic album/sticker/holding volume and
enough trading-visible collectors for trade matching to produce results.

> **Read the "Measurement boundary" section before quoting any number.** The
> roadmap p95 targets are only authoritative on the target hardware
> (Raspberry Pi 4 baseline). A CI runner or a laptop is *not* that hardware.

## What it uses

| Tool | Why |
| --- | --- |
| [k6](https://k6.io) (JavaScript, open-source, no license) | HTTP load generation, per-operation metrics and thresholds |
| The app's own seed / registration / admin module paths | Deterministic dataset without duplicating domain logic |
| PostgreSQL `EXPLAIN ANALYZE` | Plans for the latency-critical queries |

## Layout

```
load-test/
  k6/
    load-test.js          # main test: 50 concurrent users, per-operation thresholds
    slow-db.js            # slow / temporarily-unavailable database resilience probe
    lib/config.js         # env parsing, VU count, thresholds (full vs. smoke)
    lib/session.js        # Better Auth login + per-VU identity / client IP
  seed/
    seed-load-dataset.ts  # deterministic dataset provisioner (reuses app modules)
  scripts/
    run-explain.ts        # runs EXPLAIN ANALYZE on the critical queries
    degrade-db.sh         # pause / outage / latency helper for the slow-DB scenario
  sql/
    explain-analyze.sql   # the same EXPLAIN ANALYZE queries for psql
  data/
    users.json            # GENERATED credentials + collection ids (git-ignored)
    users.example.json    # shape reference
  results/
    explain-analyze.txt   # captured plans (committed as an example artifact)
  compose.loadtest.yml    # overlay that publishes the DB port for external seeding
```

## The scenario

`k6/load-test.js` runs one `constant-vus` scenario: **50 VUs** (one simulated
collector each) for a configurable duration (default `2m`). Every VU:

1. logs in once via `POST /api/auth/sign-in/email` (re-authenticating every 25
   iterations so login traffic keeps flowing under load), then each iteration
2. always performs an **album view** — `GET /api/collections/{id}/stickers`
   (the full per-sticker list that drives per-section progress; includes the
   missing anti-join semantics),
3. ~50% of the time performs a **quantity update** —
   `PUT /api/collections/{id}/holdings/{stickerId}`, followed by a sampled
   read-after-write check,
4. ~30% of the time performs **trade matching** —
   `GET /api/collections/{id}/trades` (sometimes filtered by a section),
5. sleeps a 0.5–1.5 s "think time".

Each operation is grouped and recorded in its own metric so the roadmap p95
targets apply per endpoint.

### Thresholds (roadmap targets)

Applied in the full run (`k6/lib/config.js` → `strictThresholds`):

| Metric | Threshold | Source |
| --- | --- | --- |
| `album_view_duration` | `p(95) < 400 ms` | Roadmap / #43 |
| `trade_matching_duration` | `p(95) < 1000 ms` | Roadmap / #43 |
| `quantity_update_duration` | `p(95) < 200 ms` | Roadmap / #43 |
| `domain_errors` | `count < 1` | no domain errors |
| `write_consistency_errors` | `count < 1` | no read-after-write mismatch |
| `http_req_failed` | `rate < 0.01` | — |
| `checks` | `rate > 0.99` | — |

**No domain errors / no write consistency errors.** `domain_errors` counts any
unexpected non-2xx from a domain endpoint. `write_consistency_errors` counts
read-after-write mismatches: a VU sets a quantity, re-reads its own collection
and asserts the value persisted. Because every VU mutates its own collection,
this proves persistence and isolation across collectors. It deliberately does
not claim to test concurrent writes to the same holding.

## Prerequisites

- A running Stickerfolio instance you may load against (see below).
- Node + pnpm (already required by the repo) to run the seed and EXPLAIN scripts.
- k6 installed locally (`brew install k6`, `apt-get install k6`, or the
  [official install docs](https://grafana.com/docs/k6/latest/set-up/install-k6/)).

## Step 1 — start a target instance

Any deployment works. The simplest is Docker Compose with the DB port published
so the seed can reach it:

```bash
cp .env.example .env
# set BETTER_AUTH_SECRET, POSTGRES_PASSWORD, and (recommended) a trusted IP header:
echo "AUTH_TRUSTED_IP_HEADER=x-load-test-ip" >> .env
docker compose -f compose.yml -f load-test/compose.loadtest.yml up -d --build
```

### Why the trusted IP header matters

Better Auth rate-limits `/sign-in/email` to 5 requests / minute **per client
IP** (`src/modules/identity/auth.ts`). Fifty near-simultaneous logins from one
machine would otherwise be throttled and distort the login numbers. Set
`AUTH_TRUSTED_IP_HEADER` on the target (as when running behind a trusted reverse
proxy, Roadmap 10.2) and the k6 script sends a distinct IP per VU in that header,
so each simulated user is rate-limited independently. Pass the same header name
to k6 with `--env TRUSTED_IP_HEADER=...` (the seed also records it in
`users.json`). Without it, keep VU count at or below the limit or expect 429s on
login.

## Step 2 — seed the load dataset

The seed **reuses the application's own module entry points** (it never
reimplements a domain rule):

- `seedAlbumTemplate(wm2026Template)` installs and publishes the full **Panini
  FIFA World Cup 2026** revision: **~994 stickers across 50 sections** — a
  realistic album volume.
- `registerOpenAccount(...)` creates each collector exactly like open
  self-registration (Better Auth user + Argon2id credential + collector
  profile, one transaction). Mode `"open"` is passed explicitly so seeding works
  regardless of the deployment's `REGISTRATION_MODE`; the registration policy is
  not changed.
- `markCollectorOnboardingComplete(...)` mirrors onboarding.
- `setTradingVisibility(...)` opts ~90% of collectors in, so trade matching has
  visible partners (Roadmap 8.6).
- `seedExampleHoldings(...)` creates one personal collection per collector and
  inserts holdings. A per-collector deterministic PRNG gives each collector
  **different** missing stickers and duplicates, which is what makes real one-way
  and two-way trade matches exist across the population.

```bash
# DATABASE_URL must point at the target's PostgreSQL (published on :5432 above).
DATABASE_URL=postgresql://stickerfolio:<password>@localhost:5432/stickerfolio \
APP_BASE_URL=http://localhost:3500 \
AUTH_TRUSTED_IP_HEADER=x-load-test-ip \
LOAD_USERS=50 \
pnpm loadtest:seed
```

Tunable env: `LOAD_USERS` (default 50), `LOAD_PASSWORD`,
`LOAD_OWN_PROBABILITY` (0.72), `LOAD_DUPLICATE_PROBABILITY` (0.22),
`LOAD_VISIBLE_SHARE` (0.9). The script writes `load-test/data/users.json`
(git-ignored — it holds credentials) with the per-user collection ids, the
album, and a few section ids the k6 script needs. A representative 50-user run
produces ~36k holdings including ~8k duplicates.

## Step 3 — run the load test

```bash
# full 50-user run against the target
k6 run --env BASE_URL=http://TARGET:3500 --env TRUSTED_IP_HEADER=x-load-test-ip \
  load-test/k6/load-test.js

# override VU count / duration
k6 run --env VUS=50 --env DURATION=5m load-test/k6/load-test.js

# reduced smoke (functional only; used by CI)
k6 run --env MODE=smoke load-test/k6/load-test.js
```

`BASE_URL` and `TRUSTED_IP_HEADER` also default to the values recorded in
`users.json`, so on the seeding host you can just run `k6 run load-test/k6/load-test.js`.

## Slow / temporarily-unavailable database scenario

Roadmap 12.3 requires testing slow or temporarily-unavailable database
behaviour. `k6/slow-db.js` is a resilience probe: while it runs, an operator
degrades the database out-of-band and the probe asserts the app degrades
gracefully — readiness reports the outage (503 rather than a false 200), every
request returns within a bounded time (no indefinite hang), the process does not
crash, and everything recovers to 200 afterwards. For an outage run, the probe
requires at least one failed readiness check and then enforces successful
readiness, authentication, and album access throughout its final recovery
window. It intentionally does **not** enforce the latency targets, which do not
apply while the DB is degraded.

```bash
# terminal 1: start the 60s probe; recovery is enforced from 45s onward
k6 run --env DURATION=60s load-test/k6/slow-db.js

# terminal 2: start this during the first few seconds so recovery finishes
# well before the default 45s recovery window
load-test/scripts/degrade-db.sh outage 15

# optional overrides
k6 run --env DURATION=90s --env RECOVERY_AFTER_MS=70000 load-test/k6/slow-db.js

# pure latency observation (no outage/recovery assertion)
k6 run --env EXPECT_OUTAGE=false load-test/k6/slow-db.js
load-test/scripts/degrade-db.sh latency 300
```

`pause`/`outage` use `docker compose pause` and need no extra tooling. Latency
injection needs a network-fault proxy (toxiproxy or pumba); the helper prints
the exact command rather than silently doing nothing. An outage-mode run fails
unless it both observes a non-ready response and reaches a clean recovery
window; a duration shorter than `RECOVERY_AFTER_MS` therefore fails explicitly.

## EXPLAIN ANALYZE of the critical queries

Roadmap 12.2/12.3 and #43 call for inspecting the latency-critical queries:

- **album view** (the `LEFT JOIN holdings` list, incl. the **missing anti-join**),
- **duplicates** (`quantity > 1`),
- **trade matching** (owner vs. all visible partners for the same album).

Run against a seeded database and capture the plans:

```bash
DATABASE_URL=... EXPLAIN_OUT=load-test/results/explain-analyze.txt pnpm loadtest:explain
```

`results/explain-analyze.txt` in this repo is a captured example run (PostgreSQL
18, 50 collectors / ~36k holdings). `sql/explain-analyze.sql` has the same
queries for direct use in `psql`. Notes from the captured run:

- Album view and the missing anti-join resolve via the collection-scoped
  `holdings_pkey` and the `album_revision_stickers` indexes.
- Trade matching uses `collections_trade_candidates_idx`
  `(album_id, collector_id, revision_id) WHERE status='active'` and
  `trading_preferences_visible_idx`, joining owner stickers to every visible
  partner's holdings.
- The duplicates query is collection-scoped and filters `quantity > 1` on
  `holdings_pkey` rather than the wider `holdings_sticker_quantity_idx`. Roadmap
  12.2 anticipates a narrow partial index for `quantity > 1`; the exact index
  decision should follow these plans on the target hardware and is out of scope
  for this test.

## Hardware, dataset, and measurement boundary

**Document these with every result set — a p95 number without them is meaningless.**

- **Dataset**: Panini FIFA World Cup 2026, ~994 stickers / 50 sections;
  `LOAD_USERS` collectors (default 50), ~90% trading-visible; per-collector
  randomized holdings (~72% owned, ~22% of those duplicates) →
  ~36k holdings / ~8k duplicates at 50 users. Record the exact `users.json`
  `stats` block.
- **Concurrency**: 50 constant VUs = 50 concurrent authenticated collectors,
  the roadmap's expected peak (§4.1).
- **Measurement boundary**: k6 measures end-to-end HTTP response time from the
  load generator, including network. Record where the load generator runs
  relative to the target (same host / same LAN / over the internet), the app
  instance count (MVP = 1), `DATABASE_POOL_MAX`, and the PostgreSQL version and
  location (bundled container vs. external).
- **Target hardware**: the authoritative p95 numbers **must be measured on the
  target hardware — the Raspberry Pi 4 baseline from the roadmap.** GitHub-hosted
  CI runners and developer laptops are faster and differently shaped hardware;
  their latency numbers are useful for spotting regressions and proving the test
  runs, but they are **not** the acceptance measurement. This is why the CI smoke
  (`.github/workflows/load-test-smoke.yml`) runs a reduced scenario and does
  **not** gate on the strict p95 thresholds.

## CI smoke

`.github/workflows/load-test-smoke.yml` is an optional, non-gating workflow that
brings the app up via Docker Compose (mirroring the `deployment` job in
`ci.yml`), seeds a reduced dataset (8 users) through the app's own paths,
captures EXPLAIN ANALYZE, and runs `MODE=smoke` k6 to prove the whole pipeline
executes end-to-end. It fails only on functional regressions (domain errors,
write consistency errors, failed checks), never on the hardware-specific p95
targets. The existing `quality` and `deployment` jobs are untouched.
