# Multi-user MVP release checklist

This checklist tracks release readiness for the multi-user MVP against the 21
acceptance criteria in [`ROADMAP.md` §19](ROADMAP.md). Each item has a status
and the evidence a reviewer can use to confirm it.

Status legend: **Met** = implemented and covered by tests/CI; **Verify** =
implemented, needs a final manual/traceable confirmation for release;
**Pending** = not yet delivered (tracked by an open issue).

**Current tally: 18 Met, 1 Verify (criterion 7), 2 Pending (criteria 15 and 16).**
This is a **living checklist**: issue #45 stays open until the two pending
release gates close (#44, #43) and the release/rollback evidence below is
attached. Do not treat “Met” as a substitute for the final human review.

_Last updated: 2026-07-21._

## Acceptance criteria (ROADMAP §19)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Stickerfolio uses PostgreSQL exclusively | Met | Phase 1 persistence (#3), no SQLite in production (#1); enforced by lint/CI |
| 2 | Documented Docker Compose operation with app + PostgreSQL | Met | #6; `compose.yml`, README “Docker deployment”; CI `deployment` job |
| 3 | External PostgreSQL configurable as an alternative | Met | #8; `compose.external.yml`, README; CI verifies no bundled PG service |
| 4 | Fresh install starts with no personal data and exactly one restricted first-admin | Met | Plain container/migration startup creates only the restricted admin (#27) — no collector profile, personal collection, or holding. The assisted `start.sh` additionally seeds the shared bundled **catalog templates** (albums as templates, no personal holdings) via `seed-bundled-catalogs.ts`; CI `deployment` asserts the bundled album row exists (`count = 1`) and that collector profiles and holdings are `0` |
| 5 | Personal/domain data loads only via explicit seeds, never automatically | Met | Plain container startup and migrations seed no domain data. The assisted `start.sh` explicitly seeds only the shared bundled catalog **templates** (`seed-bundled-catalogs.ts`); the example-holdings seed (#18) requires an explicit collector and never runs automatically; `pnpm seed:wm2026` is idempotent |
| 6 | Users can register, sign in, and sign out | Met | Login #24; registration modes/self-registration/invitations M1 (#30/#28/#31, PR #87) |
| 7 | An administrator can manage users and album templates | Met / Verify | Admin users #29; album template admin UI (#33). Verify the admin catalog flow end-to-end on the release build |
| 8 | A new user can select a predefined album during onboarding | Met | Onboarding #32 (PR #87); persisted completion + server guards |
| 9 | A user can manage multiple albums | Met | #22 |
| 10 | Holding quantities 0–99 work correctly | Met | Sparse holdings #11; integration tests |
| 11 | Users cannot mutate foreign holdings | Met | Ownership/IDOR guards #26; negative integration tests |
| 12 | Participating users can see potential partners for the same album | Met | Trade matching (#37/#42) + mobile overview M3 (#41, PR #92) |
| 13 | Hidden collector data never appears in trade matching | Met | Opt-in visibility #38; privacy/authorization tests #40 |
| 14 | Trade matching never changes holdings | Met | Read-only matching + overview; no mutation paths |
| 15 | Core workflows usable at iPhone 13 size | **Pending** | Automated mobile acceptance at iPhone 13 — tracked by **#44** (PR #102) |
| 16 | Load test with ~50 concurrent users passes without domain errors | **Pending** | 50-user load test + p95 targets — tracked by **#43** (PR #103) |
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
- Review the security, privacy, mobile (#44), and load (#43) results and attach them here.

## Known limitations (document at release)

- **Email verification is off** in the MVP (Roadmap §8.3); open self-registration is a deliberate per-deployment decision and defaults to `closed`.
- **Complete self-service account export** is not shipped; account deletion surfaces the per-collection CSV lists (#68) as an export-first step, and the full portable export is tracked as **#88** (deliberate §35 scope decision).
- **Single app instance** only; login, registration, and public-share rate limiters are per-process (Roadmap §10.2) — a shared limiter is required before horizontal scaling.
- **Bootstrap admin** uses a fixed initial password mitigated by a forced first-login change (randomization was considered and declined in #62).

## Remaining before release

- [ ] #44 — automated mobile acceptance at iPhone 13 (criterion 15)
- [ ] #43 — 50-user load test meeting the p95 targets (criterion 16)
- [ ] Criterion 7 — final end-to-end verification of the admin catalog flow
- [ ] Complete the release/rollback procedure above and attach evidence
