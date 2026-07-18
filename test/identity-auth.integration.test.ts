import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  createCollectorProfileForUser,
  createAuth,
  getIdentityContext,
  verifyPassword,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

function cookieFrom(response: Response): string {
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Expected a session cookie");
  return setCookie.split(";", 1)[0]!;
}

describe("Better Auth identity foundation", () => {
  beforeAll(async () => {
    await query(`TRUNCATE "user" CASCADE`, [], pool);
  });

  afterAll(async () => pool.end());

  it("creates exactly one restricted bootstrap admin under concurrent starts", async () => {
    const results = await Promise.all([
      bootstrapInitialAdmin(pool),
      bootstrapInitialAdmin(pool),
      bootstrapInitialAdmin(pool),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);

    const users = await query<{
      id: string;
      email: string;
      role: string;
      mustChangePassword: boolean;
    }>(
      `SELECT id, email, role, "mustChangePassword" FROM "user"`,
      [],
      pool,
    );
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({
      email: bootstrapAdminEmail,
      role: "admin",
      mustChangePassword: true,
    });

    const accounts = await query<{ password: string }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [users.rows[0]!.id],
      pool,
    );
    expect(accounts.rows[0]?.password).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword({ hash: accounts.rows[0]!.password, password: bootstrapAdminPassword }),
    ).resolves.toBe(true);

    const profiles = await query<{ count: string }>("SELECT count(*)::text AS count FROM collector_profiles", [], pool);
    expect(profiles.rows[0]?.count).toBe("0");
  });

  it("never recreates the account or resets its password", async () => {
    const before = await query<{ password: string }>(
      `SELECT password FROM account WHERE "providerId" = 'credential'`,
      [],
      pool,
    );
    await expect(bootstrapInitialAdmin(pool)).resolves.toBe(false);
    const after = await query<{ password: string }>(
      `SELECT password FROM account WHERE "providerId" = 'credential'`,
      [],
      pool,
    );
    expect(after.rows[0]?.password).toBe(before.rows[0]?.password);
  });

  it("keeps login identity, roles, and optional collector profiles separate", async () => {
    const admin = await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [bootstrapAdminEmail], pool);
    await expect(getIdentityContext(admin.rows[0]!.id, pool)).resolves.toMatchObject({
      role: "admin",
      collector: null,
    });

    const normalUser = await query<{ id: string }>(
      `INSERT INTO "user" (name, email, "emailVerified", role, status)
       VALUES ('Account name', 'collector-login@example.test', true, 'user', 'active') RETURNING id`,
      [],
      pool,
    );
    await createCollectorProfileForUser(normalUser.rows[0]!.id, "Public collector name", pool);
    const identity = await getIdentityContext(normalUser.rows[0]!.id, pool);
    expect(identity).toMatchObject({
      role: "user",
      collector: { displayName: "Public collector name" },
    });
    expect(identity?.collector?.displayName).not.toBe("collector-login@example.test");
    await expect(
      createCollectorProfileForUser(normalUser.rows[0]!.id, "Second profile", pool),
    ).rejects.toThrow();
  });

  it("persists, validates, and revokes PostgreSQL sessions", async () => {
    const signInResponse = await auth.api.signInEmail({
      body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword },
      asResponse: true,
    });
    expect(signInResponse.status).toBe(200);
    const setCookie = signInResponse.headers.get("set-cookie")!;
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("; Secure");
    const cookie = cookieFrom(signInResponse);
    const headers = new Headers({ cookie });

    const session = await auth.api.getSession({ headers });
    expect(session?.user).toMatchObject({
      email: bootstrapAdminEmail,
      role: "admin",
      mustChangePassword: true,
    });
    const restartedAuth = createAuth(environment, pool);
    await expect(restartedAuth.api.getSession({ headers })).resolves.toMatchObject({
      user: { email: bootstrapAdminEmail },
    });

    await auth.api.signOut({ headers });
    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
    const sessions = await query<{ count: string }>("SELECT count(*)::text AS count FROM session", [], pool);
    expect(sessions.rows[0]?.count).toBe("0");
  });

  it("rejects expired sessions", async () => {
    const response = await auth.api.signInEmail({
      body: { email: bootstrapAdminEmail, password: bootstrapAdminPassword },
      asResponse: true,
    });
    const headers = new Headers({ cookie: cookieFrom(response) });
    await query(`UPDATE session SET "expiresAt" = now() - interval '1 minute'`, [], pool);
    await expect(auth.api.getSession({ headers })).resolves.toBeNull();
  });
});
