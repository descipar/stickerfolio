import { wm2026AlbumId, wm2026RevisionId } from "@/data/wm2026";
import { wm2026ExampleHoldings } from "@/data/examples/wm2026-example-holdings";
import { closeDatabasePool, getPool, query, withTransaction } from "@/infrastructure/database";
import {
  seedExampleHoldings,
  type ExampleHoldingsDataset,
} from "@/modules/collections";
import { markCollectorOnboardingComplete } from "@/modules/collectors";
import { createCollectorProfileForUser, hashPassword, normalizeEmail } from "@/modules/identity";
import { setTradingVisibility } from "@/modules/trading";

/**
 * Deterministic fixture data for the mobile end-to-end acceptance suite
 * (see GitHub issue #44). This script is idempotent and only ever creates the
 * fixed set of accounts below, so it is safe to re-run against the same
 * database. It relies solely on the application's own module use cases plus
 * direct writes that mirror the bootstrap and registration paths; it never
 * introduces a second source of truth for credentials or holdings.
 *
 * Prerequisites: migrations applied (`pnpm db:migrate`) and the World Cup 2026
 * catalog seeded (`pnpm seed:wm2026`).
 */

export const e2eUsers = {
  collector: {
    email: "collector@e2e.test",
    password: "e2e-collector-pass",
    displayName: "E2E Collector",
  },
  partner: {
    email: "partner@e2e.test",
    password: "e2e-partner-pass",
    displayName: "E2E Partner",
  },
  newcomer: {
    email: "onboarding@e2e.test",
    password: "e2e-onboarding-pass",
    displayName: "E2E Newcomer",
  },
  firstAdmin: {
    email: "firstadmin@e2e.test",
    password: "e2e-admin-temp",
    displayName: "E2E First Admin",
  },
} as const;

// A minimal complementary dataset for the trade partner: every code is one the
// example-holdings collector is missing, and the partner owns two of each, so
// the partner offers those to the collector. The partner owns nothing else, so
// the collector's own spares are wanted by the partner, producing a two-way match.
const partnerHoldings: ExampleHoldingsDataset = {
  id: "e2e-partner",
  albumId: wm2026AlbumId,
  revisionId: wm2026RevisionId,
  quantities: { MEX5: 2, MEX7: 2, MEX8: 2, RSA5: 2 },
};

interface SeedUser {
  email: string;
  password: string;
  displayName: string;
}

async function ensureUser(
  user: SeedUser,
  options: { role: "user" | "admin"; mustChangePassword: boolean; withProfile: boolean },
): Promise<{ userId: string; collectorId: string | null }> {
  const email = normalizeEmail(user.email);
  const existing = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [email]);
  if (existing.rows[0]) {
    const collector = await query<{ id: string }>(
      "SELECT id FROM collector_profiles WHERE user_id = $1",
      [existing.rows[0].id],
    );
    return { userId: existing.rows[0].id, collectorId: collector.rows[0]?.id ?? null };
  }

  const passwordHash = await hashPassword(user.password);
  return withTransaction(async (client) => {
    const created = await query<{ id: string }>(
      `INSERT INTO "user" (name, email, "emailVerified", "mustChangePassword", role, status)
       VALUES ($1, $2, true, $3, $4, 'active') RETURNING id`,
      [user.displayName, email, options.mustChangePassword, options.role],
      client,
    );
    const userId = created.rows[0]!.id;
    await query(
      `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, 'credential', $2, $3, now(), now())`,
      [userId, userId, passwordHash],
      client,
    );
    let collectorId: string | null = null;
    if (options.withProfile) {
      const profile = await createCollectorProfileForUser(userId, user.displayName, client);
      collectorId = profile.id;
    }
    return { userId, collectorId };
  }, getPool());
}

async function main(): Promise<void> {
  try {
    const collector = await ensureUser(e2eUsers.collector, {
      role: "user",
      mustChangePassword: false,
      withProfile: true,
    });
    if (!collector.collectorId) throw new Error("Collector profile was not created.");
    await markCollectorOnboardingComplete(collector.collectorId);
    await setTradingVisibility(collector.collectorId, true);
    await seedExampleHoldings(collector.collectorId, wm2026ExampleHoldings);

    const partner = await ensureUser(e2eUsers.partner, {
      role: "user",
      mustChangePassword: false,
      withProfile: true,
    });
    if (!partner.collectorId) throw new Error("Partner profile was not created.");
    await markCollectorOnboardingComplete(partner.collectorId);
    await setTradingVisibility(partner.collectorId, true);
    await seedExampleHoldings(partner.collectorId, partnerHoldings);

    // Newcomer keeps onboarding pending on purpose (no profile completion).
    await ensureUser(e2eUsers.newcomer, {
      role: "user",
      mustChangePassword: false,
      withProfile: true,
    });

    // First-admin analogue: an admin without a collector profile that is locked
    // until the temporary password is changed.
    await ensureUser(e2eUsers.firstAdmin, {
      role: "admin",
      mustChangePassword: true,
      withProfile: false,
    });

    console.info("Seeded end-to-end fixtures: collector, partner, newcomer and first-admin accounts.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "End-to-end fixture seed failed.");
    process.exitCode = 1;
  } finally {
    await closeDatabasePool();
  }
}

void main();
