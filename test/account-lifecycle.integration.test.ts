import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  AdminError,
  createManagedUser,
  deleteManagedUser,
  setManagedUserStatus,
} from "@/modules/admin";
import { seedAlbumTemplate } from "@/modules/catalog";
import { addOwnCollection, setOwnHoldingQuantity } from "@/modules/collections";
import {
  acceptInvitation,
  AccountLifecycleError,
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
  createInvitation,
  deactivateOwnAccount,
  deleteOwnAccount,
  exportOwnAccountData,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = crypto.randomUUID();
const revisionId = crypto.randomUUID();
const sectionId = crypto.randomUUID();
const stickerOne = crypto.randomUUID();
const stickerTwo = crypto.randomUUID();
const stickerThree = crypto.randomUUID();

const adminPassword = "Admin-pass-1!";
const alicePassword = "Alice-pass-1!";
const bobPassword = "Bob-pass-1!";
const adminBPassword = "Adminb-pass-1!";

function cookieFrom(response: Response): string {
  const value = response.headers.get("set-cookie");
  if (!value) throw new Error("Expected a session cookie");
  return value.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<{ status: number; headers: Headers }> {
  return signInWith(auth, email, password);
}

async function signInWith(
  authInstance: typeof auth,
  email: string,
  password: string,
): Promise<{ status: number; headers: Headers }> {
  const response = await authInstance.api.signInEmail({ body: { email, password }, asResponse: true });
  return {
    status: response.status,
    headers: response.status === 200 ? new Headers({ cookie: cookieFrom(response) }) : new Headers(),
  };
}

async function graphCounts(userId: string) {
  const result = await query<{
    users: number;
    accounts: number;
    sessions: number;
    profiles: number;
    collections: number;
    holdings: number;
    trading: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM "user" WHERE id = $1) AS users,
       (SELECT count(*)::int FROM account WHERE "userId" = $1) AS accounts,
       (SELECT count(*)::int FROM session WHERE "userId" = $1) AS sessions,
       (SELECT count(*)::int FROM collector_profiles WHERE user_id = $1) AS profiles,
       (SELECT count(*)::int FROM collections c
          JOIN collector_profiles cp ON cp.id = c.collector_id
         WHERE cp.user_id = $1) AS collections,
       (SELECT count(*)::int FROM holdings h
          JOIN collections c ON c.id = h.collection_id
          JOIN collector_profiles cp ON cp.id = c.collector_id
         WHERE cp.user_id = $1) AS holdings,
       (SELECT count(*)::int FROM trading_preferences tp
          JOIN collector_profiles cp ON cp.id = tp.collector_id
         WHERE cp.user_id = $1) AS trading`,
    [userId],
    pool,
  );
  return result.rows[0]!;
}

describe("account lifecycle: suspension, deactivation, and deletion", () => {
  let adminHeaders: Headers;
  let aliceHeaders: Headers;
  let adminId: string;
  let adminBId: string;
  let aliceId: string;
  let bobId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "lifecycle-test", title: "Lifecycle test album" },
      revision: { id: revisionId, number: 1, label: "First", status: "published" },
      sections: [{ id: sectionId, code: "A", name: "Team A", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId, code: "A1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId, code: "A2", label: "Two", sortOrder: 1 },
        { stableId: stickerThree, stableKey: "three", sectionId, code: "A3", label: "Three", sortOrder: 2 },
      ],
    }, pool);

    await bootstrapInitialAdmin(pool);
    const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initial.headers, bootstrapAdminPassword, adminPassword, auth, pool);
    adminHeaders = (await signIn(bootstrapAdminEmail, adminPassword)).headers;
    adminId = (await query<{ id: string }>(`SELECT id FROM "user" WHERE email = $1`, [bootstrapAdminEmail], pool)).rows[0]!.id;

    aliceId = (await createManagedUser(adminHeaders, {
      email: "alice@example.test",
      displayName: "Alice",
      initialPassword: alicePassword,
      role: "user",
    }, auth, pool)).id;
    bobId = (await createManagedUser(adminHeaders, {
      email: "bob@example.test",
      displayName: "Bob",
      initialPassword: bobPassword,
      role: "user",
    }, auth, pool)).id;
    adminBId = (await createManagedUser(adminHeaders, {
      email: "admin-b@example.test",
      displayName: "Second admin",
      initialPassword: adminBPassword,
      role: "admin",
    }, auth, pool)).id;

    await query(
      `UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`,
      [[aliceId, bobId, adminBId]],
      pool,
    );
    aliceHeaders = (await signIn("alice@example.test", alicePassword)).headers;
    const bobHeaders = (await signIn("bob@example.test", bobPassword)).headers;

    const aliceCollection = await addOwnCollection(aliceHeaders, albumId, auth, pool);
    await setOwnHoldingQuantity(aliceHeaders, aliceCollection.id, stickerOne, 2, auth, pool);
    await setOwnHoldingQuantity(aliceHeaders, aliceCollection.id, stickerTwo, 1, auth, pool);
    const bobCollection = await addOwnCollection(bobHeaders, albumId, auth, pool);
    await setOwnHoldingQuantity(bobHeaders, bobCollection.id, stickerOne, 3, auth, pool);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.end();
  });

  it("blocks sign-in for an administrator-suspended account and restores it on reactivation", async () => {
    await setManagedUserStatus(adminHeaders, aliceId, "suspended", auth, pool);
    await expect(auth.api.getSession({ headers: aliceHeaders })).resolves.toBeNull();
    expect((await signIn("alice@example.test", alicePassword)).status).not.toBe(200);

    await setManagedUserStatus(adminHeaders, aliceId, "active", auth, pool);
    const reactivated = await signIn("alice@example.test", alicePassword);
    expect(reactivated.status).toBe(200);
    aliceHeaders = reactivated.headers;
  });

  it("lets a user deactivate their own account and blocks sign-in until reactivation", async () => {
    await expect(deactivateOwnAccount(aliceHeaders, "wrong-password", auth, pool)).rejects.toBeInstanceOf(AccountLifecycleError);

    await deactivateOwnAccount(aliceHeaders, alicePassword, auth, pool);
    await expect(auth.api.getSession({ headers: aliceHeaders })).resolves.toBeNull();
    expect((await signIn("alice@example.test", alicePassword)).status).not.toBe(200);

    await setManagedUserStatus(adminHeaders, aliceId, "active", auth, pool);
    const reactivated = await signIn("alice@example.test", alicePassword);
    expect(reactivated.status).toBe(200);
    aliceHeaders = reactivated.headers;
  });

  it("treats the sole active administrator as the last one even when a suspended administrator exists", async () => {
    // Suspend the second administrator so only the bootstrap admin can sign in.
    await setManagedUserStatus(adminHeaders, adminBId, "suspended", auth, pool);

    // The bootstrap admin is now the only ACTIVE administrator; it must not be
    // able to delete or deactivate itself even though a suspended admin exists,
    // otherwise nobody could sign in to reactivate that suspended admin.
    await expect(deleteOwnAccount(adminHeaders, adminPassword, bootstrapAdminEmail, auth, pool))
      .rejects.toMatchObject({ status: 409 });
    await expect(deactivateOwnAccount(adminHeaders, adminPassword, auth, pool))
      .rejects.toMatchObject({ status: 409 });
    // The admin-panel delete of the sole active admin is refused for the same
    // reason (here it also hits the self-delete guard, which is fine).
    await expect(deleteManagedUser(adminHeaders, adminId, bootstrapAdminEmail, auth, pool))
      .rejects.toBeInstanceOf(AdminError);
    expect((await graphCounts(adminId)).users).toBe(1);

    // Restore the second administrator to active for the remaining tests.
    await setManagedUserStatus(adminHeaders, adminBId, "active", auth, pool);
  });

  it("deletes only the target user's graph, keeping every other user intact", async () => {
    const bobBefore = await graphCounts(bobId);
    expect(bobBefore.holdings).toBeGreaterThan(0);
    const aliceBefore = await graphCounts(aliceId);

    await expect(
      deleteManagedUser(adminHeaders, bobId, "typo@example.test", auth, pool),
    ).rejects.toBeInstanceOf(AdminError);
    expect((await graphCounts(bobId)).users).toBe(1);

    // Resolving proves the cascade completed with no foreign-key violation.
    await expect(deleteManagedUser(adminHeaders, bobId, "bob@example.test", auth, pool)).resolves.toBeUndefined();
    expect(await graphCounts(bobId)).toEqual({
      users: 0,
      accounts: 0,
      sessions: 0,
      profiles: 0,
      collections: 0,
      holdings: 0,
      trading: 0,
    });
    // Another user is untouched by the deletion.
    expect(await graphCounts(aliceId)).toEqual(aliceBefore);
    // The shared catalog is untouched.
    const catalog = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM album_revision_stickers WHERE revision_id = $1`,
      [revisionId],
      pool,
    );
    expect(catalog.rows[0]!.count).toBe(3);
  });

  it("exports only the signed-in user's complete portable account data", async () => {
    const otherUser = await createManagedUser(adminHeaders, {
      email: "export-neighbor@example.test",
      displayName: "Export Neighbor",
      initialPassword: "Neighbor-pass-1!",
      role: "user",
    }, auth, pool);
    await query(
      `UPDATE "user" SET "mustChangePassword" = false WHERE id = $1`,
      [otherUser.id],
      pool,
    );
    const otherHeaders = (await signIn("export-neighbor@example.test", "Neighbor-pass-1!")).headers;
    const otherCollection = await addOwnCollection(otherHeaders, albumId, auth, pool);
    await setOwnHoldingQuantity(otherHeaders, otherCollection.id, stickerThree, 4, auth, pool);

    await query(
      `UPDATE trading_preferences SET visible = true, updated_at = now()
        WHERE collector_id = (SELECT id FROM collector_profiles WHERE user_id = $1)`,
      [aliceId],
      pool,
    );
    const exportedAt = new Date("2026-07-28T12:00:00.000Z");
    const data = await exportOwnAccountData(aliceHeaders, auth, pool, exportedAt);

    expect(data).toMatchObject({
      format: "stickerfolio-account-export",
      version: 1,
      exportedAt: exportedAt.toISOString(),
      account: {
        id: aliceId,
        name: "Alice",
        email: "alice@example.test",
        role: "user",
        status: "active",
      },
      collector: {
        displayName: "Alice",
        tradingPreferences: { visible: true },
        collections: [
          {
            album: { id: albumId, slug: "lifecycle-test", title: "Lifecycle test album" },
            revision: { id: revisionId, number: 1 },
          },
        ],
      },
    });
    expect(data.collector?.collections[0]?.holdings.map(({ stickerId, quantity }) => ({
      stickerId,
      quantity,
    }))).toEqual([
      { stickerId: stickerOne, quantity: 2 },
      { stickerId: stickerTwo, quantity: 1 },
      { stickerId: stickerThree, quantity: 0 },
    ]);

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain(bootstrapAdminEmail);
    expect(serialized).not.toContain("export-neighbor@example.test");
    expect(serialized).not.toContain(otherCollection.id);
    expect(serialized).not.toContain("password");
    expect(serialized).not.toContain("token");
    await expect(exportOwnAccountData(new Headers(), auth, pool)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("exports a valid empty account document when no collector profile exists", async () => {
    const data = await exportOwnAccountData(adminHeaders, auth, pool);
    expect(data.account.id).toBe(adminId);
    expect(data.collector).toBeNull();
  });

  it("refuses to remove the last remaining administrator", async () => {
    // Two administrators exist, so deleting the second one is allowed.
    await expect(deleteManagedUser(adminHeaders, adminBId, "admin-b@example.test", auth, pool)).resolves.toBeUndefined();

    // The bootstrap administrator is now the only one and is protected.
    await expect(deleteOwnAccount(adminHeaders, adminPassword, bootstrapAdminEmail, auth, pool))
      .rejects.toMatchObject({ status: 409 });
    await expect(deactivateOwnAccount(adminHeaders, adminPassword, auth, pool))
      .rejects.toMatchObject({ status: 409 });
    // An administrator cannot delete their own account through the management panel.
    await expect(deleteManagedUser(adminHeaders, adminId, bootstrapAdminEmail, auth, pool))
      .rejects.toBeInstanceOf(AdminError);
    expect((await graphCounts(adminId)).users).toBe(1);
  });

  it("deletes an account through self-service with password and email confirmation, minimizing the audit trail", async () => {
    await expect(deleteOwnAccount(aliceHeaders, "wrong-password", "alice@example.test", auth, pool))
      .rejects.toBeInstanceOf(AccountLifecycleError);
    await expect(deleteOwnAccount(aliceHeaders, alicePassword, "not-alice@example.test", auth, pool))
      .rejects.toBeInstanceOf(AccountLifecycleError);
    expect((await graphCounts(aliceId)).users).toBe(1);

    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(deleteOwnAccount(aliceHeaders, alicePassword, "alice@example.test", auth, pool)).resolves.toBeUndefined();
    expect(await graphCounts(aliceId)).toEqual({
      users: 0,
      accounts: 0,
      sessions: 0,
      profiles: 0,
      collections: 0,
      holdings: 0,
      trading: 0,
    });

    const events = output.mock.calls
      .map((call) => JSON.parse(String(call[0])))
      .filter((event) => event.event === "security.audit");
    const deletion = events.find((event) => event.audit.action === "account.deleted");
    expect(deletion).toBeTruthy();
    expect(deletion.audit.actorUserId).toEqual(expect.any(String));
    expect(deletion.audit.targetId).toEqual(expect.any(String));
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain(stickerOne);
    output.mockRestore();
  });
});

/**
 * Combined lifecycle: deleting a user who created invitations must not remove
 * the invitations. The agreed data policy (M1, #87) makes
 * `invitations.created_by_user_id` NULLABLE with ON DELETE SET NULL, so a
 * pending invitation survives deletion with its creator cleared to NULL, and an
 * accepted invitation survives keeping its acceptor while the creator is
 * cleared. This is the test the deletion code (both admin- and self-service
 * paths) deferred until the real invitations table landed on main.
 */
describe("account lifecycle: deleting an invitation creator preserves the invitations", () => {
  const lifecyclePool = createPool(environment);
  const lifecycleAuth = createAuth(environment, lifecyclePool);

  const primaryAdminPassword = "Primary-admin-1!";

  interface InvitationRow {
    created_by_user_id: string | null;
    accepted_by_user_id: string | null;
    email: string;
  }

  async function invitationRow(id: string): Promise<InvitationRow | undefined> {
    const result = await query<InvitationRow>(
      `SELECT created_by_user_id, accepted_by_user_id, email FROM invitations WHERE id = $1`,
      [id],
      lifecyclePool,
    );
    return result.rows[0];
  }

  async function invitationCount(): Promise<number> {
    const result = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM invitations`,
      [],
      lifecyclePool,
    );
    return result.rows[0]!.count;
  }

  let primaryAdminHeaders: Headers;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], lifecyclePool);
    await bootstrapInitialAdmin(lifecyclePool);
    const initial = await signInWith(lifecycleAuth, bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initial.headers, bootstrapAdminPassword, primaryAdminPassword, lifecycleAuth, lifecyclePool);
    primaryAdminHeaders = (await signInWith(lifecycleAuth, bootstrapAdminEmail, primaryAdminPassword)).headers;
  });

  afterAll(async () => {
    await lifecyclePool.end();
  });

  it("keeps pending and accepted invitations when their admin creator is deleted via deleteManagedUser", async () => {
    // A second administrator is the invitation creator; the bootstrap admin
    // stays behind so removing the creator is never a last-admin deletion.
    const creator = await createManagedUser(
      primaryAdminHeaders,
      {
        email: "invite-admin@example.test",
        displayName: "Invite Admin",
        initialPassword: "Invite-admin-1!",
        role: "admin",
      },
      lifecycleAuth,
      lifecyclePool,
    );

    const pending = await createInvitation(
      { email: "pending-target@example.test", displayName: "Pending Target", createdByUserId: creator.id },
      lifecyclePool,
    );
    const toAccept = await createInvitation(
      { email: "accepted-target@example.test", displayName: "Accepted Target", createdByUserId: creator.id },
      lifecyclePool,
    );
    // Another user accepts the second invitation, creating the acceptor account.
    const acceptor = await acceptInvitation(
      { token: toAccept.token, password: "Accepted-pass-1!", displayName: "Accepted Target" },
      lifecyclePool,
      "invitation",
    );

    expect((await invitationRow(pending.id))?.created_by_user_id).toBe(creator.id);
    expect((await invitationRow(toAccept.id))?.accepted_by_user_id).toBe(acceptor.userId);
    expect(await invitationCount()).toBe(2);

    // Deleting the creator through the admin panel must succeed and must not
    // delete the invitations (created_by is cleared via ON DELETE SET NULL).
    await expect(
      deleteManagedUser(primaryAdminHeaders, creator.id, "invite-admin@example.test", lifecycleAuth, lifecyclePool),
    ).resolves.toBeUndefined();

    // The creator user is gone.
    const creatorGone = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "user" WHERE id = $1`,
      [creator.id],
      lifecyclePool,
    );
    expect(creatorGone.rows[0]!.count).toBe(0);

    // Both invitations survive; the creator link is now NULL on both.
    expect(await invitationCount()).toBe(2);
    const pendingAfter = await invitationRow(pending.id);
    expect(pendingAfter).toBeTruthy();
    expect(pendingAfter!.created_by_user_id).toBeNull();
    expect(pendingAfter!.accepted_by_user_id).toBeNull();

    const acceptedAfter = await invitationRow(toAccept.id);
    expect(acceptedAfter).toBeTruthy();
    expect(acceptedAfter!.created_by_user_id).toBeNull();
    // The accepted invitation keeps its acceptor, whose account still exists.
    expect(acceptedAfter!.accepted_by_user_id).toBe(acceptor.userId);
    const acceptorStillHere = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "user" WHERE id = $1`,
      [acceptor.userId],
      lifecyclePool,
    );
    expect(acceptorStillHere.rows[0]!.count).toBe(1);
  });

  it("keeps pending and accepted invitations when their creator deletes their own account via deleteOwnAccount", async () => {
    // A regular user is recorded as the creator of the invitations, then removes
    // their own account through self-service.
    const selfUserPassword = "Selfuser-pass-1!";
    const selfUser = await createManagedUser(
      primaryAdminHeaders,
      {
        email: "self-creator@example.test",
        displayName: "Self Creator",
        initialPassword: selfUserPassword,
        role: "user",
      },
      lifecycleAuth,
      lifecyclePool,
    );
    // Clear the first-login password change so the user can sign in directly.
    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = $1`, [selfUser.id], lifecyclePool);
    const selfHeaders = (await signInWith(lifecycleAuth, "self-creator@example.test", selfUserPassword)).headers;

    const countBefore = await invitationCount();
    const pending = await createInvitation(
      { email: "self-pending@example.test", displayName: "Self Pending", createdByUserId: selfUser.id },
      lifecyclePool,
    );
    const toAccept = await createInvitation(
      { email: "self-accepted@example.test", displayName: "Self Accepted", createdByUserId: selfUser.id },
      lifecyclePool,
    );
    const acceptor = await acceptInvitation(
      { token: toAccept.token, password: "Selfaccept-pass-1!", displayName: "Self Accepted" },
      lifecyclePool,
      "invitation",
    );

    // Self-service deletion succeeds for a non-administrator.
    await expect(
      deleteOwnAccount(selfHeaders, selfUserPassword, "self-creator@example.test", lifecycleAuth, lifecyclePool),
    ).resolves.toBeUndefined();

    const selfGone = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "user" WHERE id = $1`,
      [selfUser.id],
      lifecyclePool,
    );
    expect(selfGone.rows[0]!.count).toBe(0);

    // Both new invitations survive with their creator cleared to NULL.
    expect(await invitationCount()).toBe(countBefore + 2);
    const pendingAfter = await invitationRow(pending.id);
    expect(pendingAfter).toBeTruthy();
    expect(pendingAfter!.created_by_user_id).toBeNull();
    expect(pendingAfter!.accepted_by_user_id).toBeNull();

    const acceptedAfter = await invitationRow(toAccept.id);
    expect(acceptedAfter).toBeTruthy();
    expect(acceptedAfter!.created_by_user_id).toBeNull();
    expect(acceptedAfter!.accepted_by_user_id).toBe(acceptor.userId);
  });
});
