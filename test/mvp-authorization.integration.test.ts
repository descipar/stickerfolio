import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import {
  AdminError,
  createManagedUser,
  listManagedUsers,
  resetManagedUserPassword,
  setManagedUserRole,
  setManagedUserStatus,
} from "@/modules/admin";
import { seedAlbumTemplate } from "@/modules/catalog";
import {
  CollectionError,
  addOwnCollection,
  getCollectionsOverview,
  getOwnCollectionStickers,
  setOwnHoldingQuantity,
} from "@/modules/collections";
import {
  AuthenticationError,
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
  verifyPassword,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = "81e7181d-1e67-5a4d-815b-3fbd4ba69916";
const revisionId = "5963d770-5f97-5554-a27d-dc6bf290470d";
const sectionId = "10cd9ab6-0b4c-54b9-aee8-13f37071062b";
const stickerOne = "c75e3f40-2b18-5e52-921c-5dc0d1ebeb02";
const stickerTwo = "0461941e-c34b-5b6f-9c4c-60633f48d92b";

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

describe("MVP authentication, administration, and collection authorization", () => {
  let adminHeaders: Headers;
  let aliceHeaders: Headers;
  let bobHeaders: Headers;
  let secondaryAdminHeaders: Headers;
  let aliceId: string;
  let bobId: string;
  let aliceCollectionId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "mvp-test", title: "MVP test album" },
      revision: { id: revisionId, number: 1, label: "First", status: "published" },
      sections: [{ id: sectionId, code: "A", name: "Team A", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId, code: "A1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId, code: "A2", label: "Two", sortOrder: 1 },
      ],
    }, pool);
    await bootstrapInitialAdmin(pool);
  });

  afterAll(async () => pool.end());

  it("gates the bootstrap administrator until the initial password is changed", async () => {
    const initial = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    expect(initial.response.status).toBe(200);
    await expect(getCollectionsOverview(initial.headers, auth, pool)).rejects.toMatchObject({
      status: 403,
    });
    await expect(listManagedUsers(initial.headers, auth, pool)).rejects.toBeInstanceOf(AdminError);

    await changeOwnPassword(
      initial.headers,
      bootstrapAdminPassword,
      "A-new-admin-password!",
      auth,
      pool,
    );
    const initialPassword = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    expect(initialPassword.response.status).not.toBe(200);
    const changed = await signIn(bootstrapAdminEmail, "A-new-admin-password!");
    expect(changed.response.status).toBe(200);
    adminHeaders = changed.headers;

    const admin = await query<{ must_change: boolean }>(
      `SELECT "mustChangePassword" AS must_change FROM "user" WHERE email = $1`,
      [bootstrapAdminEmail],
      pool,
    );
    expect(admin.rows[0]?.must_change).toBe(false);
    await expect(getCollectionsOverview(adminHeaders, auth, pool)).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("creates collector accounts without exposing plaintext passwords", async () => {
    const alice = await createManagedUser(adminHeaders, {
      email: "alice@example.test",
      displayName: "Alice",
      initialPassword: "Alice-password-1!",
      role: "user",
    }, auth, pool);
    const bob = await createManagedUser(adminHeaders, {
      email: "bob@example.test",
      displayName: "Bob",
      initialPassword: "Bob-password-1!",
      role: "user",
    }, auth, pool);
    const secondaryAdmin = await createManagedUser(adminHeaders, {
      email: "other-admin@example.test",
      displayName: "Other admin",
      initialPassword: "Admin-password-1!",
      role: "admin",
    }, auth, pool);
    aliceId = alice.id;
    bobId = bob.id;

    const credential = await query<{ password: string }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [aliceId],
      pool,
    );
    expect(credential.rows[0]?.password).toMatch(/^\$argon2id\$/);
    expect(credential.rows[0]?.password).not.toContain("Alice-password-1!");
    await expect(verifyPassword({ hash: credential.rows[0]!.password, password: "Alice-password-1!" })).resolves.toBe(true);

    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`, [[alice.id, bob.id, secondaryAdmin.id]], pool);
    aliceHeaders = (await signIn("alice@example.test", "Alice-password-1!")).headers;
    bobHeaders = (await signIn("bob@example.test", "Bob-password-1!")).headers;
    secondaryAdminHeaders = (await signIn("other-admin@example.test", "Admin-password-1!")).headers;
  });

  it("derives collection ownership from the session and blocks IDOR attempts", async () => {
    aliceCollectionId = (await addOwnCollection(aliceHeaders, albumId, auth, pool)).id;
    const bobCollectionId = (await addOwnCollection(bobHeaders, albumId, auth, pool)).id;

    await setOwnHoldingQuantity(aliceHeaders, aliceCollectionId, stickerOne, 2, auth, pool);
    await expect(getOwnCollectionStickers(aliceHeaders, aliceCollectionId, auth, pool)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: stickerOne, quantity: 2 })]),
    );
    await expect(getOwnCollectionStickers(bobHeaders, aliceCollectionId, auth, pool)).rejects.toBeInstanceOf(CollectionError);
    await expect(setOwnHoldingQuantity(bobHeaders, aliceCollectionId, stickerOne, 9, auth, pool)).rejects.toBeInstanceOf(CollectionError);
    await expect(setOwnHoldingQuantity(aliceHeaders, aliceCollectionId, crypto.randomUUID(), 1, auth, pool)).rejects.toBeInstanceOf(CollectionError);

    await expect(getOwnCollectionStickers(secondaryAdminHeaders, aliceCollectionId, auth, pool)).rejects.toBeInstanceOf(CollectionError);
    await expect(getOwnCollectionStickers(secondaryAdminHeaders, bobCollectionId, auth, pool)).rejects.toBeInstanceOf(CollectionError);
    const stored = await query<{ quantity: number }>(
      `SELECT quantity FROM holdings WHERE collection_id = $1 AND sticker_id = $2`,
      [aliceCollectionId, stickerOne],
      pool,
    );
    expect(stored.rows[0]?.quantity).toBe(2);
  });

  it("requires administrator authorization and never returns holdings", async () => {
    await expect(listManagedUsers(aliceHeaders, auth, pool)).rejects.toBeInstanceOf(AdminError);
    const users = await listManagedUsers(adminHeaders, auth, pool);
    expect(users.find((user) => user.id === aliceId)).toMatchObject({
      email: "alice@example.test",
      displayName: "Alice",
      role: "user",
      status: "active",
    });
    expect(JSON.stringify(users)).not.toContain("quantity");
    expect(JSON.stringify(users)).not.toContain(stickerOne);
  });

  it("resets passwords and suspends accounts while revoking active sessions", async () => {
    await resetManagedUserPassword(adminHeaders, bobId, "Bob-password-reset!", auth, pool);
    await expect(auth.api.getSession({ headers: bobHeaders })).resolves.toBeNull();
    expect((await signIn("bob@example.test", "Bob-password-1!")).response.status).not.toBe(200);
    const resetLogin = await signIn("bob@example.test", "Bob-password-reset!");
    expect(resetLogin.response.status).toBe(200);
    await expect(getCollectionsOverview(resetLogin.headers, auth, pool)).rejects.toMatchObject({ status: 403 });

    await setManagedUserStatus(adminHeaders, aliceId, "suspended", auth, pool);
    await expect(auth.api.getSession({ headers: aliceHeaders })).resolves.toBeNull();
    expect((await signIn("alice@example.test", "Alice-password-1!")).response.status).not.toBe(200);
    await setManagedUserStatus(adminHeaders, aliceId, "active", auth, pool);
    expect((await signIn("alice@example.test", "Alice-password-1!")).response.status).toBe(200);

    await setManagedUserRole(adminHeaders, bobId, "admin", auth, pool);
    const bob = await query<{ role: string }>(`SELECT role FROM "user" WHERE id = $1`, [bobId], pool);
    expect(bob.rows[0]?.role).toBe("admin");
  });
});
