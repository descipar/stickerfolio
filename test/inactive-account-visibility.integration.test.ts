import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createAuth, resolveSessionPrincipal } from "@/auth";
import { createPool, query } from "@/infrastructure/database";
import { createManagedUser, setManagedUserStatus } from "@/modules/admin";
import { seedAlbumTemplate } from "@/modules/catalog";
import {
  createCollection,
  createCollectionShare,
  loadSharedCollection,
  setHoldingQuantity,
} from "@/modules/collections";
import {
  bootstrapAdminEmail,
  bootstrapAdminPassword,
  bootstrapInitialAdmin,
  changeOwnPassword,
  deactivateOwnAccount,
} from "@/modules/identity";
import {
  calculateDirectComparison,
  calculateTradeMatches,
  createComparisonGrant,
  prepareDirectComparison,
  setTradingVisibility,
} from "@/modules/trading";

import { createTestEnvironment } from "./create-test-environment";

/**
 * Issue #123: suspended (by an administrator) or self-deactivated accounts must
 * disappear from everything other users can see — trade matching, public share
 * links, and direct comparisons — and reappear on reactivation without any
 * stored preference, link, or grant being changed.
 */
const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const albumId = "3c1f6a52-7e0b-5d43-9f8a-2b6d4e1a9c01";
const revisionId = "3c1f6a52-7e0b-5d43-9f8a-2b6d4e1a9c02";
const sectionId = "3c1f6a52-7e0b-5d43-9f8a-2b6d4e1a9c03";
const stickerOne = "3c1f6a52-7e0b-5d43-9f8a-2b6d4e1a9c04";
const stickerTwo = "3c1f6a52-7e0b-5d43-9f8a-2b6d4e1a9c05";

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

describe("inactive accounts are invisible to other users", () => {
  let adminHeaders: Headers;
  let partnerUserId: string;
  let viewerCollectorId: string;
  let viewerCollectionId: string;
  let partnerCollectorId: string;
  let shareToken: string;
  let comparisonCode: string;

  async function partnerVisibility() {
    const matches = await calculateTradeMatches(viewerCollectorId, viewerCollectionId, {}, pool);
    const shared = await loadSharedCollection(shareToken, pool);
    const setup = await prepareDirectComparison(viewerCollectorId, { code: comparisonCode }, pool);
    const comparison = await calculateDirectComparison(
      viewerCollectorId, viewerCollectionId, { code: comparisonCode }, pool,
    );
    return {
      inMatching: matches.matches.some((match) => match.displayName === "Partner"),
      shareLink: shared !== null,
      comparisonSetup: setup !== null,
      comparisonResult: comparison !== null,
    };
  }

  const visible = { inMatching: true, shareLink: true, comparisonSetup: true, comparisonResult: true };
  const hidden = { inMatching: false, shareLink: false, comparisonSetup: false, comparisonResult: false };

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "inactive-visibility", title: "Inactive visibility album" },
      revision: { id: revisionId, number: 1, label: "Original", status: "published" },
      sections: [{ id: sectionId, code: "A", name: "Team A", sortOrder: 0 }],
      stickers: [
        { stableId: stickerOne, stableKey: "one", sectionId, code: "A1", label: "One", sortOrder: 0 },
        { stableId: stickerTwo, stableKey: "two", sectionId, code: "A2", label: "Two", sortOrder: 1 },
      ],
    }, pool);
    await bootstrapInitialAdmin(pool);
    const initialAdmin = await signIn(bootstrapAdminEmail, bootstrapAdminPassword);
    await changeOwnPassword(await resolveSessionPrincipal(initialAdmin, auth, pool), bootstrapAdminPassword, "Admin-secure-1!", pool);
    adminHeaders = await signIn(bootstrapAdminEmail, "Admin-secure-1!");

    const users = await Promise.all([
      createManagedUser(await resolveSessionPrincipal(adminHeaders, auth, pool), { email: "viewer@inactive.test", displayName: "Viewer", initialPassword: "Viewer-secure-1!", role: "user" }, pool),
      createManagedUser(await resolveSessionPrincipal(adminHeaders, auth, pool), { email: "partner@inactive.test", displayName: "Partner", initialPassword: "Partner-secure-1!", role: "user" }, pool),
    ]);
    await query(`UPDATE "user" SET "mustChangePassword" = false WHERE id = ANY($1::uuid[])`, [users.map((user) => user.id)], pool);
    partnerUserId = users[1]!.id;
    const profiles = await query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM collector_profiles WHERE user_id = ANY($1::uuid[])`,
      [users.map((user) => user.id)],
      pool,
    );
    const profileFor = (userId: string) => profiles.rows.find((profile) => profile.user_id === userId)!.id;
    viewerCollectorId = profileFor(users[0]!.id);
    partnerCollectorId = profileFor(partnerUserId);

    viewerCollectionId = (await createCollection(viewerCollectorId, albumId, pool)).id;
    const partnerCollectionId = (await createCollection(partnerCollectorId, albumId, pool)).id;
    // The partner offers a spare of sticker one, which the viewer is missing.
    await setHoldingQuantity(partnerCollectorId, partnerCollectionId, stickerOne, 3, pool);
    await setHoldingQuantity(viewerCollectorId, viewerCollectionId, stickerTwo, 1, pool);
    await setTradingVisibility(viewerCollectorId, true, pool);
    await setTradingVisibility(partnerCollectorId, true, pool);

    shareToken = (await createCollectionShare(partnerCollectorId, partnerCollectionId, "both", null, pool)).token;
    comparisonCode = (await createComparisonGrant(partnerCollectorId, partnerCollectionId, pool)).code;
  });

  afterAll(async () => pool.end());

  it("shows an active partner everywhere", async () => {
    expect(await partnerVisibility()).toEqual(visible);
  });

  it("hides a partner suspended by an administrator and restores them on reactivation", async () => {
    await setManagedUserStatus(await resolveSessionPrincipal(adminHeaders, auth, pool), partnerUserId, "suspended", pool);
    expect(await partnerVisibility()).toEqual(hidden);

    await setManagedUserStatus(await resolveSessionPrincipal(adminHeaders, auth, pool), partnerUserId, "active", pool);
    expect(await partnerVisibility()).toEqual(visible);
  });

  it("hides a partner who deactivated their own account", async () => {
    const partnerHeaders = await signIn("partner@inactive.test", "Partner-secure-1!");
    await deactivateOwnAccount(await resolveSessionPrincipal(partnerHeaders, auth, pool), "Partner-secure-1!", pool);
    expect(await partnerVisibility()).toEqual(hidden);

    const preferences = await query<{ visible: boolean }>(
      `SELECT visible FROM trading_preferences WHERE collector_id = $1`,
      [partnerCollectorId],
      pool,
    );
    expect(preferences.rows[0]?.visible).toBe(true);

    await setManagedUserStatus(await resolveSessionPrincipal(adminHeaders, auth, pool), partnerUserId, "active", pool);
    expect(await partnerVisibility()).toEqual(visible);
  });
});
