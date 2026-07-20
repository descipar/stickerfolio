import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  InvitationError,
  acceptInvitation,
  createInvitation,
  findValidInvitationByToken,
  hashInvitationToken,
  revokeInvitation,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const mode = "invitation" as const;

async function createAdmin(): Promise<string> {
  const admin = await query<{ id: string }>(
    `INSERT INTO "user" (name, email, "emailVerified", role, status)
     VALUES ('Inviter', 'inviter@example.test', true, 'admin', 'active') RETURNING id`,
    [],
    pool,
  );
  return admin.rows[0]!.id;
}

describe("invitation links with expiring single-use tokens", () => {
  let adminId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", collector_profiles, invitations CASCADE`, [], pool);
    adminId = await createAdmin();
  });

  afterAll(async () => pool.end());

  it("stores only the token hash, never the plaintext token", async () => {
    const invitation = await createInvitation(
      { email: "invitee@example.test", displayName: "Invitee", createdByUserId: adminId },
      pool,
    );
    const stored = await query<{ token_hash: string }>(
      `SELECT token_hash FROM invitations WHERE id = $1`,
      [invitation.id],
      pool,
    );
    expect(stored.rows[0]?.token_hash).toBe(hashInvitationToken(invitation.token));
    expect(stored.rows[0]?.token_hash).not.toBe(invitation.token);
    const anyPlaintext = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM invitations WHERE token_hash = $1`,
      [invitation.token],
      pool,
    );
    expect(anyPlaintext.rows[0]?.count).toBe("0");
  });

  it("accepts a valid invitation exactly once and creates a collector profile", async () => {
    const invitation = await createInvitation(
      { email: "accept-once@example.test", displayName: "Once", createdByUserId: adminId },
      pool,
    );
    const accepted = await acceptInvitation({ token: invitation.token, password: "Invited-pass-1!" }, pool, mode);
    expect(accepted.email).toBe("accept-once@example.test");
    const profile = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM collector_profiles WHERE user_id = $1`,
      [accepted.userId],
      pool,
    );
    expect(profile.rows[0]?.count).toBe("1");

    // A used token cannot be reused.
    await expect(
      acceptInvitation({ token: invitation.token, password: "Invited-pass-2!" }, pool, mode),
    ).rejects.toBeInstanceOf(InvitationError);
    const users = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "user" WHERE email = $1`,
      ["accept-once@example.test"],
      pool,
    );
    expect(users.rows[0]?.count).toBe("1");
  });

  it("rejects expired and revoked invitations without creating any data", async () => {
    const expired = await createInvitation({ email: "expired@example.test", createdByUserId: adminId }, pool);
    await query(`UPDATE invitations SET expires_at = now() - interval '1 hour' WHERE id = $1`, [expired.id], pool);
    await expect(findValidInvitationByToken(expired.token, pool, mode)).resolves.toBeNull();
    await expect(
      acceptInvitation({ token: expired.token, password: "Expired-pass-1!", displayName: "Ex" }, pool, mode),
    ).rejects.toBeInstanceOf(InvitationError);

    const revoked = await createInvitation({ email: "revoked@example.test", createdByUserId: adminId }, pool);
    await revokeInvitation(revoked.id, pool);
    await expect(
      acceptInvitation({ token: revoked.token, password: "Revoked-pass-1!", displayName: "Rv" }, pool, mode),
    ).rejects.toBeInstanceOf(InvitationError);

    const created = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "user" WHERE email IN ('expired@example.test', 'revoked@example.test')`,
      [],
      pool,
    );
    expect(created.rows[0]?.count).toBe("0");
  });

  it("permits only one winner under concurrent acceptance", async () => {
    const invitation = await createInvitation(
      { email: "concurrent@example.test", displayName: "Race", createdByUserId: adminId },
      pool,
    );
    const results = await Promise.allSettled([
      acceptInvitation({ token: invitation.token, password: "Concurrent-1!" }, pool, mode),
      acceptInvitation({ token: invitation.token, password: "Concurrent-1!" }, pool, mode),
      acceptInvitation({ token: invitation.token, password: "Concurrent-1!" }, pool, mode),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const users = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "user" WHERE email = $1`,
      ["concurrent@example.test"],
      pool,
    );
    expect(users.rows[0]?.count).toBe("1");
  });

  it("is unavailable outside invitation mode", async () => {
    const invitation = await createInvitation({ email: "wrong-mode@example.test", createdByUserId: adminId }, pool);
    await expect(
      acceptInvitation({ token: invitation.token, password: "Wrong-mode-1!", displayName: "Wm" }, pool, "open"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      acceptInvitation({ token: invitation.token, password: "Wrong-mode-1!", displayName: "Wm" }, pool, "closed"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(findValidInvitationByToken(invitation.token, pool, "closed")).resolves.toBeNull();
  });
});
