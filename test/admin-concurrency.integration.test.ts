import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  AdminError,
  createManagedUser,
  deleteManagedUser,
  setManagedUserRole,
  setManagedUserStatus,
} from "@/modules/admin";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

/**
 * Deterministic reproduction of the last-active-administrator race described in
 * issue #89. With exactly two active administrators, one request deletes admin B
 * while a concurrent, already-authorized request suspends (or demotes) admin A.
 *
 * The two operations are made to contend genuinely: a barrier transaction holds
 * the `role = 'admin' FOR UPDATE` lock while both operations are launched, so
 * both block on the shared administrator lock. Releasing the barrier lets them
 * serialize on that lock, and the second one observes the first one's committed
 * effect. This exercises the exact window the fix closes, independently of
 * wall-clock timing.
 *
 * Whichever operation acquires the lock first commits; the other then finds the
 * acting administrator no longer valid (deleted, suspended, or demoted) and
 * aborts. Either grant order therefore leaves exactly one successful operation
 * and at least one active administrator, so the assertions are order-independent.
 */
const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const adminAPassword = "Admin-a-pass-1!";
const adminBPassword = "Admin-b-pass-1!";
const adminBEmail = "admin-b@example.test";

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected a session cookie");
  return value.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (response.status !== 200) throw new Error(`Sign-in failed for ${email} (${response.status})`);
  return new Headers({ cookie: cookieFrom(response) });
}

interface TwoAdmins {
  aId: string;
  bId: string;
  aHeaders: Headers;
  bHeaders: Headers;
}

/**
 * Rebuilds an installation with EXACTLY two active administrators, A (the
 * bootstrap admin) and B, each holding a valid session. Two admins is the
 * minimum that makes the race meaningful: removing one and disabling the other
 * could otherwise reach zero active administrators.
 */
async function setupTwoActiveAdmins(): Promise<TwoAdmins> {
  await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
  await bootstrapInitialAdmin(pool);

  const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
  await changeOwnPassword(initial, bootstrapAdminPassword, adminAPassword, auth, pool);
  const aHeaders = await signIn(bootstrapAdminEmail, adminAPassword);
  const aId = (await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [bootstrapAdminEmail], pool)).rows[0]!.id;

  const b = await createManagedUser(
    aHeaders,
    { email: adminBEmail, displayName: "Second Admin", initialPassword: adminBPassword, role: "admin" },
    auth,
    pool,
  );
  await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = $1`, [b.id], pool);
  const bHeaders = await signIn(adminBEmail, adminBPassword);

  return { aId, bId: b.id, aHeaders, bHeaders };
}

async function activeAdministratorCount(): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "user" WHERE role = 'admin' AND status = 'active'`,
    [],
    pool,
  );
  return result.rows[0]!.count;
}

async function administratorCount(): Promise<number> {
  const result = await query<{ count: number }>(
    `SELECT count(*)::int AS count FROM "user" WHERE role = 'admin'`,
    [],
    pool,
  );
  return result.rows[0]!.count;
}

/**
 * Polls until at least `expected` backends are blocked waiting on a heavyweight
 * lock, which is how a `FOR UPDATE` row-lock wait shows up in pg_stat_activity.
 * This guarantees both concurrent operations have reached the shared
 * administrator lock before the barrier is released.
 */
async function waitForLockWaiters(expected: number, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    const result = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      [],
      pool,
    );
    if (result.rows[0]!.count >= expected) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${expected} lock waiters (saw ${result.rows[0]!.count}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/**
 * Runs `first` and `second` so they both contend for the administrator lock,
 * then returns the settled results in launch order.
 */
async function runContending(
  first: () => Promise<void>,
  second: () => Promise<void>,
): Promise<PromiseSettledResult<void>[]> {
  const barrier = await pool.connect();
  try {
    await barrier.query("BEGIN");
    await barrier.query(`SELECT id FROM "user" WHERE role = 'admin' FOR UPDATE`);

    const firstRun = first();
    const secondRun = second();
    // Both operations authorize against the session, then block on the barrier's
    // administrator-row lock. Wait until both are genuinely blocked.
    await waitForLockWaiters(2);

    await barrier.query("COMMIT");
    return await Promise.allSettled([firstRun, secondRun]);
  } finally {
    barrier.release();
  }
}

describe("admin concurrency: last-active-administrator races", () => {
  beforeAll(async () => {
    // Fail fast with a clear message if the shared administrator lock is missing
    // and both operations run unserialized.
    await setupTwoActiveAdmins();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lets only one of concurrent deletion and suspension win and keeps an active administrator", async () => {
    const { aId, bId, aHeaders, bHeaders } = await setupTwoActiveAdmins();

    const results = await runContending(
      () => deleteManagedUser(aHeaders, bId, adminBEmail, auth, pool),
      () => setManagedUserStatus(bHeaders, aId, "suspended", auth, pool),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    // The losing operation is refused because its acting administrator is no
    // longer a valid active administrator, or because it would remove the last one.
    expect(rejected[0]!.reason).toBeInstanceOf(AdminError);

    expect(await activeAdministratorCount()).toBeGreaterThanOrEqual(1);
  });

  it("lets only one of concurrent deletion and role demotion win and keeps an active administrator", async () => {
    const { aId, bId, aHeaders, bHeaders } = await setupTwoActiveAdmins();

    const results = await runContending(
      () => deleteManagedUser(aHeaders, bId, adminBEmail, auth, pool),
      () => setManagedUserRole(bHeaders, aId, "user", auth, pool),
    );

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(AdminError);

    // Exactly one administrator remains and is active: either A (demotion lost)
    // or B (deletion lost, A demoted to user).
    expect(await administratorCount()).toBe(1);
    expect(await activeAdministratorCount()).toBe(1);
  });
});
