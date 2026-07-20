import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { handleTradeMatchesRequest } from "@/app/api/collections/[collectionId]/trades/route";
import { createPool, query } from "@/infrastructure/database";
import { createManagedUser } from "@/modules/admin";
import { archiveRevision, seedAlbumTemplate } from "@/modules/catalog";
import { createCollection, setHoldingQuantity } from "@/modules/collections";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  createAuth,
} from "@/modules/identity";
import {
  calculateTradeMatches,
  getOwnTradeMatches,
  getTradingVisibility,
  setOwnTradingVisibility,
  setTradingVisibility,
} from "@/modules/trading";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = "6e911b89-57c6-5ed2-bba6-703318062329";
const revisionOne = "d43eea0f-ec07-548d-9994-d95043611142";
const revisionTwo = "7f7f569e-e53d-59cf-a2db-cad1f3c4b55c";
const sectionAOne = "9a84b353-6016-50ad-9c61-3709be3272ad";
const sectionBOne = "e770a16d-53c2-5c22-afcc-148fb4d429b7";
const sectionATwo = "bb7fd08c-d5b9-53f7-b1f2-1c8ed30dc5cb";
const stickerOne = "a69c646d-b3e0-5e14-8b8d-b190b7f26167";
const stickerTwo = "ea3bf983-bc1f-574f-b1d7-eebacffbda47";
const stickerThree = "fb39ed7b-4a55-5904-aee8-00f2428f504c";
const stickerFour = "22c0ee64-c540-530f-8136-f8da10ba2691";

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

describe("privacy-preserving trade matching", () => {
  let adminHeaders: Headers;
  let ownerHeaders: Headers;
  let twoWayHeaders: Headers;
  let ownerId: string;
  let ownerCollectorId: string;
  let twoWayCollectorId: string;
  let hiddenCollectorId: string;
  let ownerCollectionId: string;
  let twoWayCollectionId: string;
  let crossRevisionCollectionId: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "trade-test", title: "Trade test album" },
      revision: { id: revisionOne, number: 1, label: "Original", status: "published" },
      sections: [
        { id: sectionAOne, code: "A", name: "Team A", sortOrder: 0 },
        { id: sectionBOne, code: "B", name: "Team B", sortOrder: 1 },
      ],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId: sectionAOne, code: "A1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId: sectionAOne, code: "A2", label: "Two", sortOrder: 1 },
        { stableId: stickerThree, stableKey: "three", sectionId: sectionAOne, code: "A3", label: "Three", sortOrder: 2 },
        { stableId: stickerFour, stableKey: "four", sectionId: sectionBOne, code: "B1", label: "Four", sortOrder: 3 },
      ],
    }, pool);
    await bootstrapInitialAdmin(pool);
    const initialAdmin = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initialAdmin, bootstrapAdminPassword, "Admin-secure-1!", auth, pool);
    adminHeaders = await signIn(bootstrapAdminEmail, "Admin-secure-1!");

    const users = await Promise.all([
      createManagedUser(adminHeaders, { email: "owner@trade.test", displayName: "Owner", initialPassword: "Owner-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "two-way@trade.test", displayName: "Alex Two-way", initialPassword: "Two-way-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "cross@trade.test", displayName: "Blair Cross", initialPassword: "Cross-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "hidden@trade.test", displayName: "Hidden collector", initialPassword: "Hidden-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "other@trade.test", displayName: "Other album", initialPassword: "Other-secure-1!", role: "user" }, auth, pool),
    ]);
    ownerId = users[0]!.id;
    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`, [users.map((user) => user.id)], pool);
    const profiles = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM collector_profiles WHERE user_id = ANY($1::uuid[])`,
      [users.map((user) => user.id)],
      pool,
    );
    const profileFor = (userId: string) => profiles.rows.find((profile) => profile.user_id === userId)!.id;
    ownerCollectorId = profileFor(users[0]!.id);
    twoWayCollectorId = profileFor(users[1]!.id);
    const crossCollectorId = profileFor(users[2]!.id);
    hiddenCollectorId = profileFor(users[3]!.id);
    const unrelatedCollectorId = profileFor(users[4]!.id);

    ownerHeaders = await signIn("owner@trade.test", "Owner-secure-1!");
    twoWayHeaders = await signIn("two-way@trade.test", "Two-way-secure-1!");

    expect(await getTradingVisibility(ownerCollectorId, pool)).toBe(false);
    ownerCollectionId = (await createCollection(ownerCollectorId, albumId, pool)).id;
    twoWayCollectionId = (await createCollection(twoWayCollectorId, albumId, pool)).id;
    const hiddenCollectionId = (await createCollection(hiddenCollectorId, albumId, pool)).id;

    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerTwo, 2, pool);
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerThree, 1, pool);
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerFour, 2, pool);
    await setHoldingQuantity(twoWayCollectorId, twoWayCollectionId, stickerOne, 3, pool);
    await setHoldingQuantity(twoWayCollectorId, twoWayCollectionId, stickerThree, 1, pool);
    await setHoldingQuantity(hiddenCollectorId, hiddenCollectionId, stickerOne, 2, pool);

    await setTradingVisibility(ownerCollectorId, true, pool);
    await setTradingVisibility(twoWayCollectorId, true, pool);
    await setTradingVisibility(hiddenCollectorId, false, pool);

    const unrelatedAlbumId = "7a98155b-da9b-5e09-8d1e-5d584f5e4b72";
    const unrelatedRevision = "8bc286f3-235c-52d4-b84d-af0de7b8aa30";
    const unrelatedSection = "9a2d467e-c487-5796-baf2-4627e072d249";
    const unrelatedSticker = "3844f9d2-ef39-5457-9071-fd6d68a75f42";
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: unrelatedAlbumId, slug: "unrelated-trade-test", title: "Unrelated" },
      revision: { id: unrelatedRevision, number: 1, label: "Original", status: "published" },
      sections: [{ id: unrelatedSection, code: "X", name: "Other", sortOrder: 0 }],
      stickers: [{ stableId: unrelatedSticker, stableKey: "other", sectionId: unrelatedSection, code: "X1", label: "Other", sortOrder: 0 }],
    }, pool);
    const unrelatedCollection = await createCollection(unrelatedCollectorId, unrelatedAlbumId, pool);
    await setHoldingQuantity(unrelatedCollectorId, unrelatedCollection.id, unrelatedSticker, 5, pool);
    await setTradingVisibility(unrelatedCollectorId, true, pool);

    await archiveRevision(revisionOne, pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "trade-test", title: "Trade test album" },
      revision: { id: revisionTwo, number: 2, label: "Replacement", status: "published" },
      sections: [{ id: sectionATwo, code: "NEW", name: "New team", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId: sectionATwo, code: "NEW1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId: sectionATwo, code: "NEW2", label: "Two", sortOrder: 1 },
        { stableId: stickerThree, stableKey: "three", sectionId: sectionATwo, code: "NEW3", label: "Three", sortOrder: 2 },
      ],
    }, pool);
    crossRevisionCollectionId = (await createCollection(crossCollectorId, albumId, pool)).id;
    await setHoldingQuantity(crossCollectorId, crossRevisionCollectionId, stickerOne, 2, pool);
    await setHoldingQuantity(crossCollectorId, crossRevisionCollectionId, stickerTwo, 1, pool);
    await setTradingVisibility(crossCollectorId, true, pool);
  });

  afterAll(async () => pool.end());

  it("keeps new profiles hidden and applies owner-only opt-in changes immediately", async () => {
    expect(await getTradingVisibility(ownerCollectorId, pool)).toBe(true);
    await setOwnTradingVisibility(twoWayHeaders, false, auth, pool);
    expect(await getTradingVisibility(twoWayCollectorId, pool)).toBe(false);
    expect(await getTradingVisibility(ownerCollectorId, pool)).toBe(true);
    expect((await calculateTradeMatches(ownerCollectorId, ownerCollectionId, {}, pool)).total).toBe(1);
    await setOwnTradingVisibility(twoWayHeaders, true, auth, pool);
    expect((await calculateTradeMatches(ownerCollectorId, ownerCollectionId, {}, pool)).total).toBe(2);

    await setOwnTradingVisibility(ownerHeaders, false, auth, pool);
    await expect(calculateTradeMatches(ownerCollectorId, ownerCollectionId, {}, pool)).resolves.toMatchObject({
      enabled: false,
      total: 0,
      matches: [],
    });
    await setOwnTradingVisibility(ownerHeaders, true, auth, pool);
  });

  it("calculates empty, one-way, two-way, and cross-revision matches with stable IDs", async () => {
    const result = await calculateTradeMatches(ownerCollectorId, ownerCollectionId, {}, pool);
    expect(result.matches.map((match) => [match.displayName, match.kind])).toEqual([
      ["Alex Two-way", "two-way"],
      ["Blair Cross", "one-way"],
    ]);
    expect(result.matches[0]).toMatchObject({ offeredCount: 1, wantedCount: 2 });
    expect(result.matches[1]).toMatchObject({
      offersToYou: [{ code: "A1", partnerCode: "NEW1", spareCount: 1 }],
      needsFromYou: [],
    });
    expect(JSON.stringify(result)).not.toContain(stickerFour);
    expect(result.matches.some((match) => match.displayName === "Hidden collector")).toBe(false);
    expect(result.matches.some((match) => match.displayName === "Other album")).toBe(false);
  });

  it("filters before counting and keeps deterministic sorting", async () => {
    const holdingsBefore = await query<{ collection_id: string; sticker_id: string; quantity: number }>(
      `SELECT collection_id, sticker_id, quantity
         FROM holdings
        ORDER BY collection_id, sticker_id`,
      [],
      pool,
    );
    const teamA = await calculateTradeMatches(ownerCollectorId, ownerCollectionId, { sectionId: sectionAOne }, pool);
    expect(teamA.matches[0]).toMatchObject({ displayName: "Alex Two-way", offeredCount: 1, wantedCount: 1 });
    const teamB = await calculateTradeMatches(ownerCollectorId, ownerCollectionId, { sectionId: sectionBOne }, pool);
    expect(teamB.matches).toEqual([
      expect.objectContaining({ displayName: "Alex Two-way", kind: "one-way", offeredCount: 0, wantedCount: 1 }),
    ]);
    await expect(calculateTradeMatches(ownerCollectorId, ownerCollectionId, { direction: "two-way" }, pool)).resolves.toMatchObject({
      total: 1,
      matches: [expect.objectContaining({ displayName: "Alex Two-way" })],
    });
    await expect(calculateTradeMatches(ownerCollectorId, ownerCollectionId, { direction: "one-way", sort: "name" }, pool)).resolves.toMatchObject({
      total: 1,
      matches: [expect.objectContaining({ displayName: "Blair Cross" })],
    });
    await expect(calculateTradeMatches(ownerCollectorId, ownerCollectionId, { sort: "wanted", limit: 1 }, pool)).resolves.toMatchObject({
      total: 2,
      limit: 1,
      matches: [expect.objectContaining({ displayName: "Alex Two-way", wantedCount: 2 })],
    });
    const holdingsAfter = await query<{ collection_id: string; sticker_id: string; quantity: number }>(
      `SELECT collection_id, sticker_id, quantity
         FROM holdings
        ORDER BY collection_id, sticker_id`,
      [],
      pool,
    );
    expect(holdingsAfter.rows).toEqual(holdingsBefore.rows);
  });

  it("returns only relevant public fields through the API", async () => {
    const response = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${ownerCollectionId}/trades`, { headers: ownerHeaders }),
      ownerCollectionId,
      (headers, collectionId, options) => getOwnTradeMatches(headers, collectionId, options, auth, pool),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(body.total).toBe(2);
    expect(serialized).not.toContain("@trade.test");
    expect(serialized).not.toContain("collectorId");
    expect(serialized).not.toContain("collectionId");
    expect(serialized).not.toContain("quantity");
    expect(serialized).not.toContain(stickerThree);
    expect(serialized).not.toContain("Hidden collector");
    expect(serialized).not.toContain("Other album");
  });

  it("blocks manipulated collection IDs, anonymous users, expired sessions, and admins", async () => {
    const foreign = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${twoWayCollectionId}/trades`, { headers: ownerHeaders }),
      twoWayCollectionId,
      (headers, collectionId, options) => getOwnTradeMatches(headers, collectionId, options, auth, pool),
    );
    expect(foreign.status).toBe(404);

    const anonymous = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${ownerCollectionId}/trades`),
      ownerCollectionId,
      (headers, collectionId, options) => getOwnTradeMatches(headers, collectionId, options, auth, pool),
    );
    expect(anonymous.status).toBe(401);

    const admin = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${ownerCollectionId}/trades`, { headers: adminHeaders }),
      ownerCollectionId,
      (headers, collectionId, options) => getOwnTradeMatches(headers, collectionId, options, auth, pool),
    );
    expect(admin.status).toBe(403);

    await query(`UPDATE session SET "expiresAt" = now() - interval '1 minute' WHERE "userId" = $1`, [ownerId], pool);
    const expired = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${ownerCollectionId}/trades`, { headers: ownerHeaders }),
      ownerCollectionId,
      (headers, collectionId, options) => getOwnTradeMatches(headers, collectionId, options, auth, pool),
    );
    expect(expired.status).toBe(401);
  });
});
