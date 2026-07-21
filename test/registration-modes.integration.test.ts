import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { RegistrationError, evaluateRegistration, registerOpenAccount } from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);

describe("configurable registration modes", () => {
  beforeAll(async () => {
    await query(`TRUNCATE "user", collector_profiles CASCADE`, [], pool);
  });

  afterAll(async () => pool.end());

  it("derives availability centrally from the configured mode", () => {
    expect(evaluateRegistration("closed")).toMatchObject({ openRegistration: false, invitations: false });
    expect(evaluateRegistration("invitation")).toMatchObject({ openRegistration: false, invitations: true });
    expect(evaluateRegistration("open")).toMatchObject({ openRegistration: true, invitations: false });
  });

  it("creates a user and collector profile atomically in open mode", async () => {
    const { userId } = await registerOpenAccount(
      { email: "self@example.test", password: "Self-pass-1!", displayName: "Self" },
      pool,
      "open",
    );
    const profile = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM collector_profiles WHERE user_id = $1`,
      [userId],
      pool,
    );
    expect(profile.rows[0]?.count).toBe("1");
    const account = await query<{ password: string }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [userId],
      pool,
    );
    expect(account.rows[0]?.password).toMatch(/^\$argon2id\$/);
    expect(account.rows[0]?.password).not.toContain("Self-pass-1!");
  });

  it("handles a duplicate email safely without a half-created account", async () => {
    await expect(
      registerOpenAccount(
        { email: "self@example.test", password: "Self-pass-2!", displayName: "Duplicate" },
        pool,
        "open",
      ),
    ).rejects.toMatchObject({ status: 409 });
    const users = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "user" WHERE email = $1`,
      ["self@example.test"],
      pool,
    );
    expect(users.rows[0]?.count).toBe("1");
  });

  it("blocks open self-registration outside open mode and changes no data", async () => {
    for (const mode of ["closed", "invitation"] as const) {
      await expect(
        registerOpenAccount(
          { email: "blocked@example.test", password: "Blocked-1!", displayName: "Blocked" },
          pool,
          mode,
        ),
      ).rejects.toBeInstanceOf(RegistrationError);
    }
    const users = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "user" WHERE email = $1`,
      ["blocked@example.test"],
      pool,
    );
    expect(users.rows[0]?.count).toBe("0");
  });
});
