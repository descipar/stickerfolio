import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { createManagedUser } from "@/modules/admin";
import { seedAlbumTemplate } from "@/modules/catalog";
import {
  CollectionError,
  createCollection,
  createOwnCollectionShare,
  getOwnCollectionShares,
  loadSharedCollection,
  revokeOwnCollectionShare,
  setHoldingQuantity,
  updateOwnCollectionShare,
} from "@/modules/collections";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
} from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = "ca16254d-6732-5e8f-a269-251219e6c34d";
const revisionId = "90b504ea-9a5f-524e-8dc8-8d3e3bec72db";
const sectionA = "9afdeff4-8e83-5c92-a3c9-a16e9fa48899";
const sectionB = "88abb5ed-6ef7-5c9d-980b-23fb84813fa8";
const stickerA1 = "73ee6938-b211-54f7-9f4f-1c3bf9db372e";
const stickerA2 = "491cfb96-6649-5d23-86dd-acadae340d28";
const stickerA3 = "ac1ce73b-7195-5c61-81f2-110ea05a2501";
const stickerB1 = "8c183701-af15-512a-8077-ec2701047bd2";

function cookieFrom(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Expected a session cookie");
  return cookie.split(";", 1)[0]!;
}

async function signIn(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  if (response.status !== 200) throw new Error(`Could not sign in ${email}`);
  return new Headers({ cookie: cookieFrom(response) });
}

describe("revocable public collection sharing", () => {
  let ownerHeaders: Headers;
  let otherHeaders: Headers;
  let ownerCollectorId: string;
  let ownerCollectionId: string;
  let otherCollectionId: string;
  let shareId: string;
  let shareToken: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "sharing-test", title: "Sharing test album" },
      revision: { id: revisionId, number: 1, label: "Original", status: "published" },
      sections: [
        { id: sectionA, code: "A", name: "Team A", sortOrder: 0 },
        { id: sectionB, code: "B", name: "Team B", sortOrder: 1 },
      ],
      stickers: [
        { stableId: stickerA1, stableKey: "a1", sectionId: sectionA, code: "A1", label: "One", sortOrder: 0 },
        { stableId: stickerA2, stableKey: "a2", sectionId: sectionA, code: "A2", label: "Two", sortOrder: 1 },
        { stableId: stickerA3, stableKey: "a3", sectionId: sectionA, code: "A3", label: "Three", sortOrder: 2 },
        { stableId: stickerB1, stableKey: "b1", sectionId: sectionB, code: "B1", label: "Four", sortOrder: 3 },
      ],
    }, pool);

    await bootstrapInitialAdmin(pool);
    const initialAdmin = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initialAdmin, bootstrapAdminPassword, "Admin-share-1!", auth, pool);
    const adminHeaders = await signIn(bootstrapAdminEmail, "Admin-share-1!");
    const owner = await createManagedUser(adminHeaders, {
      email: "share-owner@example.test",
      displayName: "Share Owner",
      initialPassword: "Owner-share-1!",
      role: "user",
    }, auth, pool);
    const other = await createManagedUser(adminHeaders, {
      email: "share-other@example.test",
      displayName: "Other Collector",
      initialPassword: "Other-share-1!",
      role: "user",
    }, auth, pool);
    await query(
      `UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`,
      [[owner.id, other.id]],
      pool,
    );
    ownerHeaders = await signIn("share-owner@example.test", "Owner-share-1!");
    otherHeaders = await signIn("share-other@example.test", "Other-share-1!");
    const profiles = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM collector_profiles WHERE user_id = ANY($1::uuid[])`,
      [[owner.id, other.id]],
      pool,
    );
    ownerCollectorId = profiles.rows.find((profile) => profile.user_id === owner.id)!.id;
    const otherCollectorId = profiles.rows.find((profile) => profile.user_id === other.id)!.id;
    ownerCollectionId = (await createCollection(ownerCollectorId, albumId, pool)).id;
    otherCollectionId = (await createCollection(otherCollectorId, albumId, pool)).id;

    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerA1, 2, pool);
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerA2, 1, pool);
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerB1, 3, pool);
    await setHoldingQuantity(otherCollectorId, otherCollectionId, stickerA3, 99, pool);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.end();
  });

  it("creates an owner-scoped link while storing and logging no plaintext token", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const created = await createOwnCollectionShare(
      ownerHeaders,
      ownerCollectionId,
      "both",
      new Date("2030-01-01T00:00:00.000Z"),
      auth,
      pool,
    );
    shareId = created.share.id;
    shareToken = created.token;

    expect(shareToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = await query<{ token_hash: string }>(
      "SELECT token_hash FROM collection_share_links WHERE id = $1",
      [shareId],
      pool,
    );
    expect(stored.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.rows[0]?.token_hash).not.toBe(shareToken);
    expect(JSON.stringify(await getOwnCollectionShares(
      ownerHeaders,
      ownerCollectionId,
      auth,
      pool,
    ))).not.toContain(shareToken);
    expect(output.mock.calls.flat().join(" ")).not.toContain(shareToken);
    output.mockRestore();

    await expect(
      getOwnCollectionShares(otherHeaders, ownerCollectionId, auth, pool),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createOwnCollectionShare(otherHeaders, ownerCollectionId, "missing", null, auth, pool),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reveals only selected live list data without internal identities", async () => {
    const shared = await loadSharedCollection(shareToken, pool);
    expect(shared).toMatchObject({
      albumTitle: "Sharing test album",
      revisionNumber: 1,
      scope: "both",
      missingCount: 1,
      duplicateCount: 2,
      sections: [
        {
          code: "A",
          stickers: [
            { code: "A1", kind: "duplicate", spareCount: 1 },
            { code: "A3", kind: "missing", spareCount: 0 },
          ],
        },
        {
          code: "B",
          stickers: [{ code: "B1", kind: "duplicate", spareCount: 2 }],
        },
      ],
    });
    const serialized = JSON.stringify(shared);
    expect(serialized).not.toContain("@example.test");
    expect(serialized).not.toContain(ownerCollectionId);
    expect(serialized).not.toContain(otherCollectionId);
    expect(serialized).not.toContain(stickerA1);
    expect(serialized).not.toContain("Share Owner");
    expect(serialized).not.toContain("Other Collector");
    expect(serialized).not.toContain("99");
    expect(serialized).not.toContain("A2");
  });

  it("reflects quantity changes and owner-controlled scope without regenerating the link", async () => {
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerA3, 2, pool);
    const changed = await loadSharedCollection(shareToken, pool);
    expect(changed).toMatchObject({ missingCount: 0, duplicateCount: 3 });
    expect(changed?.sections[0]?.stickers.map((sticker) => [sticker.code, sticker.kind])).toEqual([
      ["A1", "duplicate"],
      ["A3", "duplicate"],
    ]);

    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerA2, 0, pool);
    await updateOwnCollectionShare(
      ownerHeaders,
      ownerCollectionId,
      shareId,
      { scope: "missing" },
      auth,
      pool,
    );
    const missingOnly = await loadSharedCollection(shareToken, pool);
    expect(missingOnly).toMatchObject({
      scope: "missing",
      missingCount: 1,
      duplicateCount: 0,
      sections: [{ stickers: [{ code: "A2", kind: "missing" }] }],
    });
  });

  it("makes expiration, revocation, and unknown tokens indistinguishable publicly", async () => {
    await expect(
      createOwnCollectionShare(
        ownerHeaders,
        ownerCollectionId,
        "both",
        new Date("2020-01-01T00:00:00.000Z"),
        auth,
        pool,
      ),
    ).rejects.toBeInstanceOf(CollectionError);

    await updateOwnCollectionShare(
      ownerHeaders,
      ownerCollectionId,
      shareId,
      { expiresAt: new Date() },
      auth,
      pool,
    );
    expect(await loadSharedCollection(shareToken, pool)).toBeNull();
    expect((await getOwnCollectionShares(ownerHeaders, ownerCollectionId, auth, pool))[0]).toMatchObject({
      id: shareId,
      status: "expired",
    });

    const revocable = await createOwnCollectionShare(
      ownerHeaders,
      ownerCollectionId,
      "duplicates",
      null,
      auth,
      pool,
    );
    await expect(loadSharedCollection(revocable.token, pool)).resolves.not.toBeNull();
    await expect(
      revokeOwnCollectionShare(ownerHeaders, ownerCollectionId, revocable.share.id, auth, pool),
    ).resolves.toBe(true);
    expect(await loadSharedCollection(revocable.token, pool)).toBeNull();
    expect(await loadSharedCollection("A".repeat(43), pool)).toBeNull();
    expect(await loadSharedCollection("invalid-token", pool)).toBeNull();
  });
});
