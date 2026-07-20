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
  AccountLifecycleError,
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
  deactivateOwnAccount,
  deleteOwnAccount,
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
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
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
    expect(catalog.rows[0]!.count).toBe(2);
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
