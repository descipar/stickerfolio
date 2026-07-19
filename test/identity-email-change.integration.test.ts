import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { AdminError, createManagedUser, setManagedUserEmail } from "@/modules/admin";
import {
  EmailChangeError,
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnEmail,
  changeOwnPassword,
  createAuth,
  normalizeEmail,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected a session cookie");
  return value.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<{ response: Response; headers: Headers }> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return {
    response,
    headers: response.status === 200 ? new Headers({ cookie: cookieFrom(response) }) : new Headers(),
  };
}

describe("login email changes (self-service and admin)", () => {
  let adminHeaders: Headers;
  let aliceHeaders: Headers;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await bootstrapInitialAdmin(pool);
    const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initial.headers, bootstrapAdminPassword, "Admin-1!", auth, pool);
    adminHeaders = (await signIn(bootstrapAdminEmail, "Admin-1!")).headers;

    const alice = await createManagedUser(adminHeaders, {
      email: "alice@example.test",
      displayName: "Alice",
      initialPassword: "Alice-pass-1!",
      role: "user",
    }, auth, pool);
    const bob = await createManagedUser(adminHeaders, {
      email: "bob@example.test",
      displayName: "Bob",
      initialPassword: "Bob-pass-1!",
      role: "user",
    }, auth, pool);
    aliceId = alice.id;
    bobId = bob.id;
    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`, [[alice.id, bob.id]], pool);
    aliceHeaders = (await signIn("alice@example.test", "Alice-pass-1!")).headers;
  });

  afterAll(async () => pool.end());

  it("normalizes to trimmed lowercase", () => {
    expect(normalizeEmail("  Person@Example.Test \n")).toBe("person@example.test");
  });

  it("changes a user's own email, normalizes it, and revokes their sessions", async () => {
    await changeOwnEmail(aliceHeaders, "  Alice-New@Example.Test  ", "Alice-pass-1!", auth, pool);
    await expect(auth.api.getSession({ headers: aliceHeaders })).resolves.toBeNull();
    expect((await signIn("alice@example.test", "Alice-pass-1!")).response.status).not.toBe(200);
    const newLogin = await signIn("alice-new@example.test", "Alice-pass-1!");
    expect(newLogin.response.status).toBe(200);
    aliceHeaders = newLogin.headers;
    const stored = await query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [aliceId], pool);
    expect(stored.rows[0]?.email).toBe("alice-new@example.test");
  });

  it("rejects a self-service change with the wrong current password", async () => {
    await expect(
      changeOwnEmail(aliceHeaders, "another@example.test", "wrong-password", auth, pool),
    ).rejects.toBeInstanceOf(EmailChangeError);
  });

  it("returns a neutral conflict when the address is already taken (self-service)", async () => {
    await expect(
      changeOwnEmail(aliceHeaders, "bob@example.test", "Alice-pass-1!", auth, pool),
    ).rejects.toMatchObject({ status: 409, message: "This email address is not available." });
    // The failed change must leave the current session and address untouched.
    await expect(auth.api.getSession({ headers: aliceHeaders })).resolves.not.toBeNull();
  });

  it("lets an administrator change another user's email and revokes that user's sessions", async () => {
    const bobHeaders = (await signIn("bob@example.test", "Bob-pass-1!")).headers;
    await setManagedUserEmail(adminHeaders, bobId, "Bob-New@Example.Test", auth, pool);
    await expect(auth.api.getSession({ headers: bobHeaders })).resolves.toBeNull();
    expect((await signIn("bob@example.test", "Bob-pass-1!")).response.status).not.toBe(200);
    expect((await signIn("bob-new@example.test", "Bob-pass-1!")).response.status).toBe(200);
  });

  it("forbids a non-admin from changing another user's email", async () => {
    await expect(
      setManagedUserEmail(aliceHeaders, bobId, "hijack@example.test", auth, pool),
    ).rejects.toBeInstanceOf(AdminError);
    const bob = await query<{ email: string }>(`SELECT email FROM "user" WHERE id = $1`, [bobId], pool);
    expect(bob.rows[0]?.email).toBe("bob-new@example.test");
  });

  it("rejects an admin change to an address that is already in use and an unknown user", async () => {
    await expect(
      setManagedUserEmail(adminHeaders, aliceId, "bob-new@example.test", auth, pool),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      setManagedUserEmail(adminHeaders, crypto.randomUUID(), "ghost@example.test", auth, pool),
    ).rejects.toMatchObject({ status: 404 });
  });
});
