# Multi-user MVP release checklist

This checklist tracks release readiness for the multi-user MVP against the 21
acceptance criteria in [`ROADMAP.md` §19](ROADMAP.md). Each item has a status
and the evidence a reviewer can use to confirm it.

Status legend: **Met** = implemented and covered by tests/CI; **Verify** =
implemented, needs a final manual/traceable confirmation for release;
**Deferred** = deliberately outside the hobby-installation release gate.

**Current tally: 21 Met.** The admin catalog flow and the release/rollback
procedure were verified on the release build on 2026-11-05 (see
[Release verification evidence](#release-verification-evidence-2026-11-05)).
The full 50-user target-hardware measurement is retained as optional capacity
validation rather than a hobby-installation release gate.

_Last updated: 2026-11-05._

## Acceptance criteria (ROADMAP §19)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Stickerfolio uses PostgreSQL exclusively | Met | Phase 1 persistence (#3), no SQLite in production (#1); enforced by lint/CI |
| 2 | Documented Docker Compose operation with app + PostgreSQL | Met | #6; `compose.yml`, README “Docker deployment”; CI `deployment` job |
| 3 | External PostgreSQL configurable as an alternative | Met | #8; `compose.external.yml`, README; CI verifies no bundled PG service |
| 4 | Fresh install starts with no personal data and exactly one restricted first-admin | Met | Plain container/migration startup creates only the restricted admin (#27) — no collector profile, personal collection, or holding. The assisted `start.sh` additionally seeds the shared bundled **catalog templates** (albums as templates, no personal holdings) via `seed-bundled-catalogs.ts`; CI `deployment` asserts the bundled album row exists (`count = 1`) and that collector profiles and holdings are `0` |
| 5 | Personal/domain data loads only via explicit seeds, never automatically | Met | Plain container startup and migrations seed no domain data. The assisted `start.sh` explicitly seeds only the shared bundled catalog **templates** (`seed-bundled-catalogs.ts`); the example-holdings seed (#18) requires an explicit collector and never runs automatically; `pnpm seed:wm2026` is idempotent |
| 6 | Users can register, sign in, and sign out | Met | Login #24; registration modes/self-registration/invitations M1 (#30/#28/#31, PR #87) |
| 7 | An administrator can manage users and album templates | Met | Admin users #29; album template admin UI (#33); admin catalog flow verified end-to-end on the release build (2026-11-05, below) |
| 8 | A new user can select a predefined album during onboarding | Met | Onboarding #32 (PR #87); persisted completion + server guards |
| 9 | A user can manage multiple albums | Met | #22 |
| 10 | Holding quantities 0–99 work correctly | Met | Sparse holdings #11; integration tests |
| 11 | Users cannot mutate foreign holdings | Met | Ownership/IDOR guards #26; negative integration tests |
| 12 | Participating users can see potential partners for the same album | Met | Trade matching (#37/#42) + mobile overview M3 (#41, PR #92) |
| 13 | Hidden collector data never appears in trade matching | Met | Opt-in visibility #38; privacy/authorization tests #40 |
| 14 | Trade matching never changes holdings | Met | Read-only matching + overview; no mutation paths |
| 15 | Core workflows usable at iPhone 13 size | Met | Automated mobile acceptance at iPhone 13 — #44 (PR #102) |
| 16 | Automated load-test smoke passes without domain errors or lost updates | Met | Non-gating functional smoke and reusable 50-user capacity harness — #43 (PR #103); a target-hardware p95 run is optional before materially wider public use |
| 17 | PostgreSQL backup and restore documented and tested | Met | #13; `scripts/postgres-backup.sh`/`postgres-restore.sh`; CI deployment restores into a fresh DB |
| 18 | Production code contains no SQLite dependency or legacy compatibility layer | Met | #1; verified by build/lint |
| 19 | Sessions survive app restart and can be revoked server-side | Met | Better Auth PostgreSQL sessions #23; revocation on suspend/delete/email-change |
| 20 | Integration tests run against real PostgreSQL | Met | Testcontainers #9; CI `quality` job runs the integration suite |
| 21 | Bootstrap admin created only for empty user table, must change `admin123!`, never reset | Met | #27; `must_change_password` gate. Note: fixed initial password by design (randomization #62 declined; mitigated by forced change) |

## Release / rollback procedure

Before tagging a release, run and record evidence for:

- **Fresh installation** on the target: `./start.sh` on an empty database creates exactly one restricted admin and seeds only the shared bundled **catalog templates** (no collector profile, personal collection, or holding); confirm the forced first-admin password change before any admin function is reachable.
- **Bundled PostgreSQL** and **external PostgreSQL** (`compose.external.yml` + `DATABASE_URL`) both start, migrate, and serve `/api/health/ready`.
- **Seeds**: plain container startup/migrations seed no domain data; `start.sh` seeds the bundled catalog templates only; the example-holdings seed requires an explicit collector and never runs automatically; `pnpm seed:wm2026` is idempotent.
- **Backup/restore**: `scripts/postgres-backup.sh` then restore into an empty database; verify migration history.
- **Rollback**: redeploy the previous image tag; migrations roll forward with a corrective migration (no history rewrite). Database restore from the verified dump is the data-loss fallback.
- Review the security and privacy evidence plus the automated mobile (#44) and
  load-smoke (#43) results. Run and attach the optional full 50-user measurement
  before materially wider public use or capacity-sensitive deployment changes.

## Known limitations (document at release)

- **Email verification is off** in the MVP (Roadmap §8.3); open self-registration is a deliberate per-deployment decision and defaults to `closed`.
- **Performance capacity is not certified:** CI exercises the load-test path and
  correctness invariants, but the optional 50-user p95 targets have not been
  measured on representative Raspberry Pi 4 hardware.
- **Single app instance** only; login, registration, and public-share rate limiters are per-process (Roadmap §10.2) — a shared limiter is required before horizontal scaling.
- **Bootstrap admin** uses a fixed initial password mitigated by a forced first-login change (randomization was considered and declined in #62).
- **Rollback across schema changes** relies on forward-compatible migrations. The previous image ran against the newer schema in the drill, but a future destructive migration would require restoring the pre-update dump instead.
- **Cosmetic:** on onboarding album cards, the album title and its description render without spacing at mobile width (for example “…World Cup 2026994 stickers”).

## Release verification evidence (2026-11-05)

Release candidate `80bb184` (branch `fix/comparison-grant-sql-alias`), built
from a fresh clone with `./start.sh` on Docker 29.9.2 (Darwin arm64). The
images are the production `runtime` and `operations` targets (Node 22).

| Step | Result |
|------|--------|
| Fresh installation (`start.sh`, bundled PostgreSQL) | `/api/health/ready` 200; exactly one user `admin@stickerfolio.local`, role `admin`, `mustChangePassword = true`; users/albums/profiles/collections/holdings = 1/2/0/0/0 |
| Forced first-admin password change | `/admin/albums` redirects to `/password/change` and `GET /api/admin/albums` returns 403 until the password is changed; changing it clears the session |
| Seeds | Re-running migrations created no domain data and no second admin; the bundled catalog seed is idempotent (“already exists; nothing was overwritten”); the example-holdings seed exits with usage and changes nothing without `--collector`, and with an explicit collector inserted 650 holdings |
| Admin catalog flow (criterion 7) | At 390×844: bundled templates listed; starter template imported as a draft; revision 1 published; revision 2 imported and published with revision 1 archived atomically; metadata corrected; admin-created user forced to change their password, saw the corrected template in onboarding and started collecting it |
| Backup/restore | `postgres-backup.sh --compose`, restore into an empty database: row counts identical for users, albums, profiles, collections, holdings (650), comparison grants and `schema_migrations` (8). The documented destructive in-place restore brought the app back ready with holdings intact, `migrate up` reported no pending migrations, and a non-bootstrap account signed in |
| Rollback | Redeployed the previous image (`37c2e78`, schema 7) over the current schema 8: ready 200, holdings unchanged; roll-forward to the candidate ready 200 |
| External PostgreSQL | `compose.external.yml` against a separate PostgreSQL 17 container: migrations applied (8), bootstrap admin created, ready 200 |
| Automated suites | lint, typecheck, unit (67), integration (84), and mobile E2E against the release image (18, including direct comparison by code, QR link and revocation) all green |

During this pass, a release-blocking defect was found and fixed in the same
change. PostgreSQL rejected the reserved word `grant` used as a table alias.
This broke direct comparison (#95), account export and account deletion, and
had left CI on `main` red since the comparison feature landed.

## Remaining before release

- [x] Criterion 7: final end-to-end verification of the admin catalog flow
- [x] Complete the release/rollback procedure above and attach evidence
- [ ] Optional: run `pnpm benchmark:argon2` and the 50-user measurement on Raspberry Pi 4 hardware (#21)
