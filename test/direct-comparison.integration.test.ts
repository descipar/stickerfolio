import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";

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
  calculateDirectComparison,
  createOwnComparisonGrant,
  DirectComparisonError,
  getOwnComparisonGrants,
  getOwnComparisonSetup,
  getOwnDirectComparison,
  prepareDirectComparison,
  revokeOwnComparisonGrant,
} from "@/modules/trading";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = "c5a6cb88-3567-58c9-a480-1187b617c242";
const revisionOne = "d55c1628-2682-53ec-bdd8-3fe2cfdd1670";
const revisionTwo = "59585188-f8bb-529f-bb5e-c0582cba7a44";
const sectionOne = "640d32cf-403d-58c7-9ad0-a076419469d9";
const sectionTwo = "1f79b20a-ea6f-578c-964c-c9e506dcfb5b";
const stickerOne = "774a7ef1-e700-5c6f-a448-49b9e69a3575";
const stickerTwo = "f8896ac2-6440-5c3a-af8c-cf33437dd60b";
const stickerThree = "54387950-b9c4-554a-894c-6f889196322a";

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

describe("short-lived private direct collection comparisons", () => {
  let ownerHeaders: Headers;
  let viewerHeaders: Headers;
  let outsiderHeaders: Headers;
  let ownerCollectorId: string;
  let viewerCollectorId: string;
  let ownerCollectionId: string;
  let viewerCollectionId: string;
  let unrelatedCollectionId: string;
  let grantId: string;
  let token: string;
  let code: string;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "comparison-test", title: "Comparison test album" },
      revision: { id: revisionOne, number: 1, label: "Original", status: "published" },
      sections: [{ id: sectionOne, code: "OLD", name: "Original section", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId: sectionOne, code: "OLD1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId: sectionOne, code: "OLD2", label: "Two", sortOrder: 1 },
        { stableId: stickerThree, stableKey: "three", sectionId: sectionOne, code: "OLD3", label: "Three", sortOrder: 2 },
      ],
    }, pool);
    await bootstrapInitialAdmin(pool);
    const initialAdmin = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(initialAdmin, bootstrapAdminPassword, "Admin-secure-1!", auth, pool);
    const adminHeaders = await signIn(bootstrapAdminEmail, "Admin-secure-1!");
    const users = await Promise.all([
      createManagedUser(adminHeaders, { email: "owner@comparison.test", displayName: "Owner Collector", initialPassword: "Owner-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "viewer@comparison.test", displayName: "Viewer Collector", initialPassword: "Viewer-secure-1!", role: "user" }, auth, pool),
      createManagedUser(adminHeaders, { email: "outsider@comparison.test", displayName: "Outsider", initialPassword: "Outsider-secure-1!", role: "user" }, auth, pool),
    ]);
    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`, [users.map((user) => user.id)], pool);
    const profiles = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM collector_profiles WHERE user_id = ANY($1::uuid[])`,
      [users.map((user) => user.id)],
      pool,
    );
    const profileFor = (userId: string) => profiles.rows.find((profile) => profile.user_id === userId)!.id;
    ownerCollectorId = profileFor(users[0]!.id);
    viewerCollectorId = profileFor(users[1]!.id);
    const outsiderCollectorId = profileFor(users[2]!.id);
    ownerHeaders = await signIn("owner@comparison.test", "Owner-secure-1!");
    viewerHeaders = await signIn("viewer@comparison.test", "Viewer-secure-1!");
    outsiderHeaders = await signIn("outsider@comparison.test", "Outsider-secure-1!");

    ownerCollectionId = (await createCollection(ownerCollectorId, albumId, pool)).id;
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerOne, 3, pool);
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerThree, 1, pool);

    await archiveRevision(revisionOne, pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "comparison-test", title: "Comparison test album" },
      revision: { id: revisionTwo, number: 2, label: "Current", status: "published" },
      sections: [{ id: sectionTwo, code: "NEW", name: "Current section", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId: sectionTwo, code: "NEW1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId: sectionTwo, code: "NEW2", label: "Two", sortOrder: 1 },
        { stableId: stickerThree, stableKey: "three", sectionId: sectionTwo, code: "NEW3", label: "Three", sortOrder: 2 },
      ],
    }, pool);
    viewerCollectionId = (await createCollection(viewerCollectorId, albumId, pool)).id;
    await setHoldingQuantity(viewerCollectorId, viewerCollectionId, stickerTwo, 2, pool);
    await setHoldingQuantity(viewerCollectorId, viewerCollectionId, stickerThree, 1, pool);

    const unrelatedAlbumId = "2d63e705-9693-5903-af60-3d9209807fd1";
    const unrelatedRevisionId = "4004361a-5a43-5fb3-a3fc-406a273cd0fc";
    const unrelatedSectionId = "e1ee39b5-8d2d-5114-8811-e49b600d4b88";
    const unrelatedStickerId = "4ce1af89-f83e-5c74-a064-b2cd47de111e";
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: unrelatedAlbumId, slug: "unrelated-comparison", title: "Unrelated album" },
      revision: { id: unrelatedRevisionId, number: 1, label: "Original", status: "published" },
      sections: [{ id: unrelatedSectionId, code: "X", name: "Other", sortOrder: 0 }],
      stickers: [{ stableId: unrelatedStickerId, stableKey: "other", sectionId: unrelatedSectionId, code: "X1", label: "Other", sortOrder: 0 }],
    }, pool);
    unrelatedCollectionId = (await createCollection(viewerCollectorId, unrelatedAlbumId, pool)).id;
    await createCollection(outsiderCollectorId, unrelatedAlbumId, pool);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.end();
  });

  it("creates owner-scoped hashed credentials with a bounded lifetime", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const created = await createOwnComparisonGrant(ownerHeaders, ownerCollectionId, auth, pool);
    grantId = created.grant.id;
    token = created.token;
    code = created.code;

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(code).toMatch(/^[23456789A-HJ-NP-Z]{5}-[23456789A-HJ-NP-Z]{5}$/);
    const lifetime = new Date(created.grant.expiresAt).getTime() - new Date(created.grant.createdAt).getTime();
    expect(lifetime).toBeGreaterThanOrEqual(15 * 60 * 1000 - 5_000);
    expect(lifetime).toBeLessThanOrEqual(15 * 60 * 1000 + 5_000);
    const stored = await query<{ token_hash: string; code_hash: string }>(
      "SELECT token_hash, code_hash FROM collection_comparison_grants WHERE id = $1",
      [grantId],
      pool,
    );
    expect(stored.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.rows[0]?.code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored.rows[0])).not.toContain(token);
    expect(JSON.stringify(stored.rows[0])).not.toContain(code.replace("-", ""));
    expect(JSON.stringify(await getOwnComparisonGrants(ownerHeaders, ownerCollectionId, auth, pool))).not.toContain(token);
    expect(output.mock.calls.flat().join(" ")).not.toContain(token);
    expect(output.mock.calls.flat().join(" ")).not.toContain(code);
    output.mockRestore();

    await expect(getOwnComparisonGrants(viewerHeaders, ownerCollectionId, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
    await expect(revokeOwnComparisonGrant(viewerHeaders, ownerCollectionId, grantId, auth, pool)).resolves.toBe(false);
  });

  it("prepares token and manual-code flows only for a compatible foreign collection", async () => {
    await expect(getOwnComparisonSetup(viewerHeaders, { token }, auth, pool)).resolves.toEqual({
      collections: [{
        id: viewerCollectionId,
        albumTitle: "Comparison test album",
        revisionNumber: 2,
      }],
    });
    await expect(getOwnComparisonSetup(viewerHeaders, { code: code.toLowerCase() }, auth, pool)).resolves.toMatchObject({
      collections: [{ id: viewerCollectionId }],
    });
    await expect(prepareDirectComparison(ownerCollectorId, { token }, pool)).resolves.toBeNull();
    await expect(getOwnComparisonSetup(outsiderHeaders, { token }, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
    await expect(getOwnComparisonSetup(viewerHeaders, { code: "WRONG-23456" }, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
  });

  it("compares current quantities across revisions without requiring trade opt-in", async () => {
    const holdingsBefore = await query<{ collection_id: string; sticker_id: string; quantity: number }>(
      `SELECT collection_id, sticker_id, quantity FROM holdings ORDER BY collection_id, sticker_id`,
      [],
      pool,
    );
    const result = await getOwnDirectComparison(viewerHeaders, viewerCollectionId, { token }, auth, pool);
    expect(result).toMatchObject({
      albumTitle: "Comparison test album",
      partnerDisplayName: "Owner Collector",
      kind: "two-way",
      offeredCount: 1,
      wantedCount: 1,
      offersToYou: [{ code: "NEW1", partnerCode: "OLD1", spareCount: 2 }],
      needsFromYou: [{ code: "NEW2", partnerCode: "OLD2", spareCount: 1 }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("@comparison.test");
    expect(serialized).not.toContain(ownerCollectionId);
    expect(serialized).not.toContain(viewerCollectionId);
    expect(serialized).not.toContain(stickerThree);
    expect(serialized).not.toContain("quantity");
    const holdingsAfter = await query<{ collection_id: string; sticker_id: string; quantity: number }>(
      `SELECT collection_id, sticker_id, quantity FROM holdings ORDER BY collection_id, sticker_id`,
      [],
      pool,
    );
    expect(holdingsAfter.rows).toEqual(holdingsBefore.rows);

    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerOne, 1, pool);
    await expect(calculateDirectComparison(viewerCollectorId, viewerCollectionId, { code }, pool)).resolves.toMatchObject({
      kind: "one-way",
      offeredCount: 0,
      wantedCount: 1,
    });
    await setHoldingQuantity(ownerCollectorId, ownerCollectionId, stickerOne, 3, pool);
  });

  it("fails foreign collection, anonymous, expired, revoked, and unknown credentials uniformly", async () => {
    await expect(getOwnDirectComparison(viewerHeaders, unrelatedCollectionId, { token }, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
    await expect(getOwnDirectComparison(new Headers(), viewerCollectionId, { token }, auth, pool)).rejects.toMatchObject({ status: 401 });
    await expect(prepareDirectComparison(
      viewerCollectorId,
      { token },
      pool,
      new Date(Date.now() + 16 * 60 * 1000),
    )).resolves.toBeNull();
    await expect(revokeOwnComparisonGrant(ownerHeaders, ownerCollectionId, grantId, auth, pool)).resolves.toBe(true);
    await expect(getOwnComparisonSetup(viewerHeaders, { token }, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
    await expect(getOwnComparisonSetup(viewerHeaders, { token: "A".repeat(43) }, auth, pool)).rejects.toBeInstanceOf(DirectComparisonError);
  });
});
