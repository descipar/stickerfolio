import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";
import { completeOnboarding, getCollectionsOverview } from "@/modules/collections";
import { createAuth, hashPassword, registerOpenAccount, resolveIdentity } from "@/modules/identity";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);
const auth = createAuth(environment, pool);

const publishedOne = { album: crypto.randomUUID(), revision: crypto.randomUUID(), section: crypto.randomUUID(), sticker: crypto.randomUUID() };
const publishedTwo = { album: crypto.randomUUID(), revision: crypto.randomUUID(), section: crypto.randomUUID(), sticker: crypto.randomUUID() };
const draftOnly = { album: crypto.randomUUID(), revision: crypto.randomUUID(), section: crypto.randomUUID(), sticker: crypto.randomUUID() };

function template(ids: typeof publishedOne, slug: string, status: "draft" | "published") {
  return {
    formatVersion: 1,
    album: { id: ids.album, slug, title: `Album ${slug}` },
    revision: { id: ids.revision, number: 1, label: "First", status },
    sections: [{ id: ids.section, code: "A", name: "Section A", sortOrder: 0 }],
    stickers: [{ stableId: ids.sticker, stableKey: "a1", sectionId: ids.section, code: "A1", label: "One", sortOrder: 0 }],
  };
}

async function signIn(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const cookie = response.headers.get("set-cookie");
  if (!cookie) throw new Error("Expected a session cookie");
  return new Headers({ cookie: cookie.split(";", 1)[0]! });
}

describe("onboarding with collector profile and album selection", () => {
  let collectorHeaders: Headers;

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate(template(publishedOne, "published-one", "published"), pool);
    await seedAlbumTemplate(template(publishedTwo, "published-two", "published"), pool);
    await seedAlbumTemplate(template(draftOnly, "draft-only", "draft"), pool);
    await registerOpenAccount(
      { email: "collector@example.test", password: "Collector-1!", displayName: "Collector" },
      pool,
      "open",
    );
    collectorHeaders = await signIn("collector@example.test", "Collector-1!");
  });

  afterAll(async () => pool.end());

  it("offers only current published revisions and creates no accidental collection", async () => {
    const result = await completeOnboarding(collectorHeaders, { displayName: "Collector", albumIds: [] }, auth, pool);
    expect(result.collections).toHaveLength(0);
    // A deliberate zero-album completion still marks onboarding complete.
    const identity = await resolveIdentity(collectorHeaders, auth, pool);
    expect(identity?.collector?.onboardingCompleted).toBe(true);
    const overview = await getCollectionsOverview(collectorHeaders, auth, pool);
    expect(overview.collections).toHaveLength(0);
    const availableIds = overview.availableAlbums.map((album) => album.id).sort();
    expect(availableIds).toEqual([publishedOne.album, publishedTwo.album].sort());
    expect(availableIds).not.toContain(draftOnly.album);
  });

  it("creates multiple collections atomically and confirms the display name", async () => {
    const result = await completeOnboarding(
      collectorHeaders,
      { displayName: "Renamed Collector", albumIds: [publishedOne.album, publishedTwo.album] },
      auth,
      pool,
    );
    expect(result.collections).toHaveLength(2);
    const overview = await getCollectionsOverview(collectorHeaders, auth, pool);
    expect(overview.collections).toHaveLength(2);
    const profile = await query<{ display_name: string }>(
      `SELECT cp.display_name FROM collector_profiles cp JOIN "user" u ON u.id = cp.user_id WHERE u.email = $1`,
      ["collector@example.test"],
      pool,
    );
    expect(profile.rows[0]?.display_name).toBe("Renamed Collector");
  });

  it("keeps routing a returning collector to onboarding until completion is persisted", async () => {
    await registerOpenAccount(
      { email: "returning@example.test", password: "Returning-1!", displayName: "Returning" },
      pool,
      "open",
    );
    const beforeHeaders = await signIn("returning@example.test", "Returning-1!");
    const before = await resolveIdentity(beforeHeaders, auth, pool);
    expect(before?.collector?.onboardingCompleted).toBe(false);

    await completeOnboarding(beforeHeaders, { displayName: "Returning", albumIds: [] }, auth, pool);

    // A fresh sign-in (new session) still observes the persisted completion, so
    // a later sign-in can never bypass onboarding until it is actually done.
    const afterHeaders = await signIn("returning@example.test", "Returning-1!");
    const after = await resolveIdentity(afterHeaders, auth, pool);
    expect(after?.collector?.onboardingCompleted).toBe(true);
  });

  it("rejects a resubmitted onboarding that re-selects an already-owned album with a clean 409", async () => {
    await registerOpenAccount(
      { email: "resubmit@example.test", password: "Resubmit-1!", displayName: "Resubmit" },
      pool,
      "open",
    );
    const headers = await signIn("resubmit@example.test", "Resubmit-1!");
    await completeOnboarding(headers, { displayName: "Resubmit", albumIds: [publishedOne.album] }, auth, pool);

    // Do not rely on the UI's available-album list: submit the already-owned
    // album id directly. The unique constraint must surface as a domain 409.
    await expect(
      completeOnboarding(headers, { displayName: "Resubmit", albumIds: [publishedOne.album] }, auth, pool),
    ).rejects.toMatchObject({ status: 409 });

    const overview = await getCollectionsOverview(headers, auth, pool);
    expect(overview.collections).toHaveLength(1);
  });

  it("never forces an administrator without a collector profile into collector onboarding", async () => {
    const admin = await query<{ id: string }>(
      `INSERT INTO "user" (name, email, "emailVerified", "mustChangePassword", role, status)
       VALUES ('Admin', 'admin-onboard@example.test', true, false, 'admin', 'active') RETURNING id`,
      [],
      pool,
    );
    const adminId = admin.rows[0]!.id;
    await query(
      `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
       VALUES ($1, 'credential', $1, $2, now(), now())`,
      [adminId, await hashPassword("Admin-pass-1!")],
      pool,
    );
    const adminHeaders = await signIn("admin-onboard@example.test", "Admin-pass-1!");
    await expect(
      completeOnboarding(adminHeaders, { displayName: "Nope", albumIds: [publishedOne.album] }, auth, pool),
    ).rejects.toMatchObject({ status: 403 });
    const collections = await query<{ count: string }>(
      `SELECT count(*)::text AS count FROM collections c
         JOIN collector_profiles cp ON cp.id = c.collector_id
        WHERE cp.user_id = $1`,
      [adminId],
      pool,
    );
    expect(collections.rows[0]?.count).toBe("0");
  });
});
