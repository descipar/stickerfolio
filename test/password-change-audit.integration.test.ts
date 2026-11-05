import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createAuth, resolveSessionPrincipal, resolveViewer } from "@/auth";
import { exportOwnAccountData } from "@/modules/accounts";
import { createPool, query } from "@/infrastructure/database";
import { createManagedUser, setManagedUserEmail } from "@/modules/admin";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnEmail,
  changeOwnPassword,
  PasswordChangeError,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  return new Headers({ cookie: cookieFrom(response) });
}

function auditActions(output: { mock: { calls: unknown[][] } }) {
  return output.mock.calls
    .map(([line]) => JSON.parse(String(line)) as { event: string; audit?: Record<string, unknown> })
    .filter((entry) => entry.event === "security.audit")
    .map((entry) => entry.audit!);
}

describe("self-service password change (#128) and audit coverage (#129)", () => {
  let adminHeaders: Headers;
  let userId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await bootstrapInitialAdmin(pool);
    const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(await resolveSessionPrincipal(initial, auth, pool), bootstrapAdminPassword, "Audit-admin-1!", pool);
    adminHeaders = await signIn(bootstrapAdminEmail, "Audit-admin-1!");
    const created = await createManagedUser(await resolveSessionPrincipal(adminHeaders, auth, pool), {
      email: "password-user@example.test",
      displayName: "Password user",
      initialPassword: "Initial-pass-1!",
      role: "user",
    }, pool);
    userId = created.id;
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => pool.end());

  it("keeps the caller's session, revokes all others, and audits the change atomically", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const current = await signIn("password-user@example.test", "Initial-pass-1!");
    const other = await signIn("password-user@example.test", "Initial-pass-1!");

    await changeOwnPassword(await resolveSessionPrincipal(current, auth, pool), "Initial-pass-1!", "Changed-pass-2!", pool);

    expect(await resolveViewer(current, auth, pool)).toMatchObject({ userId });
    expect(await resolveViewer(other, auth, pool)).toBeNull();
    const user = await query<{ mustChangePassword: boolean }>(
      `SELECT "mustChangePassword" FROM "user" WHERE id = $1`,
      [userId],
      pool,
    );
    expect(user.rows[0]?.mustChangePassword).toBe(false);
    await expect(signIn("password-user@example.test", "Initial-pass-1!")).rejects.toThrow();
    await signIn("password-user@example.test", "Changed-pass-2!");

    expect(auditActions(output)).toEqual([
      expect.objectContaining({
        action: "account.password_changed",
        actorUserId: userId,
        targetId: userId,
        details: { revokedOtherSessions: 1 },
      }),
    ]);
    expect(JSON.stringify(output.mock.calls)).not.toContain("Changed-pass-2!");
  });

  it("changes nothing and revokes nothing when the current password is wrong", async () => {
    const current = await signIn("password-user@example.test", "Changed-pass-2!");
    const other = await signIn("password-user@example.test", "Changed-pass-2!");
    await expect(
      changeOwnPassword(await resolveSessionPrincipal(current, auth, pool), "Wrong-pass-9!", "Another-pass-3!", pool),
    ).rejects.toBeInstanceOf(PasswordChangeError);
    expect(await resolveViewer(other, auth, pool)).toMatchObject({ userId });
    await signIn("password-user@example.test", "Changed-pass-2!");
  });

  it("rejects a password outside the policy before touching the account", async () => {
    const current = await signIn("password-user@example.test", "Changed-pass-2!");
    await expect(changeOwnPassword(await resolveSessionPrincipal(current, auth, pool), "Changed-pass-2!", "abc", pool)).rejects.toBeInstanceOf(
      PasswordChangeError,
    );
  });

  it("audits account export and both email-change paths without addresses", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const headers = await signIn("password-user@example.test", "Changed-pass-2!");

    await exportOwnAccountData(await resolveSessionPrincipal(headers, auth, pool), pool);
    await changeOwnEmail(await resolveSessionPrincipal(headers, auth, pool), "renamed-user@example.test", "Changed-pass-2!", pool);
    await setManagedUserEmail(await resolveSessionPrincipal(adminHeaders, auth, pool), userId, "admin-renamed@example.test", pool);

    const events = auditActions(output);
    expect(events.map((event) => event.action)).toEqual([
      "account.exported",
      "account.email_changed",
      "account.email_changed",
    ]);
    expect(events[1]).toMatchObject({ actorUserId: userId, targetId: userId });
    expect(events[2]).toMatchObject({ actorUserId: expect.not.stringMatching(userId), targetId: userId });
    const serialized = JSON.stringify(output.mock.calls);
    expect(serialized).not.toContain("renamed-user@example.test");
    expect(serialized).not.toContain("admin-renamed@example.test");
    expect(serialized).not.toContain("identity.email_changed");
  });
});
