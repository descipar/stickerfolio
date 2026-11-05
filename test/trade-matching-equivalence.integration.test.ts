import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { archiveRevision, seedAlbumTemplate } from "@/modules/catalog";
import { createCollection } from "@/modules/collections";
import {
  calculateTradeMatches,
  setTradingVisibility,
  type TradeDirection,
  type TradeSort,
} from "@/modules/trading";

import { createTestEnvironment } from "./create-test-environment";
import { referenceTradeMatches } from "../load-test/scripts/reference-trade-matching";

/**
 * Issue #117 moved partner aggregation, filtering, sorting, and pagination
 * into PostgreSQL. This suite proves the new implementation returns exactly
 * what the previous Node.js implementation returned, over a randomized dataset
 * with many partners, two album revisions, hidden and archived collections,
 * tricky display names, and every filter/sort/page combination.
 */
const environment = createTestEnvironment(inject("databaseUrl"));
const pool = createPool(environment);

const albumId = "0b7c5f4e-6a53-5d8e-9a51-0f4f3b1c2a01";
const revisionOne = "0b7c5f4e-6a53-5d8e-9a51-0f4f3b1c2a02";
const revisionTwo = "0b7c5f4e-6a53-5d8e-9a51-0f4f3b1c2a03";
const stickerCount = 40;
const sectionCount = 4;

function uuid(prefix: string, index: number): string {
  return `${prefix}${index.toString(16).padStart(12, "0")}`;
}

// Deterministic PRNG (mulberry32) so failures are reproducible.
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function template(revisionId: string, number: number, codePrefix: string, sectionPrefix: string) {
  const sections = Array.from({ length: sectionCount }, (_, index) => ({
    id: uuid(sectionPrefix, index),
    code: `${codePrefix}S${index}`,
    name: `Section ${index}`,
    sortOrder: index,
  }));
  // Revision two reverses sticker order and moves stickers between sections so
  // stable-ID matching and owner-revision ordering are both exercised.
  const stickers = Array.from({ length: stickerCount }, (_, index) => ({
    stableId: uuid("5a5a5a5a-0000-4000-8000-", index),
    stableKey: `sticker-${index}`,
    sectionId: sections[(number === 1 ? index : index + 1) % sectionCount]!.id,
    code: `${codePrefix}${index}`,
    label: `Sticker ${index}`,
    sortOrder: number === 1 ? index : stickerCount - index,
  }));
  return {
    formatVersion: 1,
    album: { id: albumId, slug: "equivalence", title: "Equivalence album" },
    revision: { id: revisionId, number, label: `Revision ${number}`, status: "published" },
    sections,
    stickers,
  };
}

// Names that differ between bytewise and locale-aware ordering, plus duplicates
// so ties fall through to the collector-ID tie-breaker.
const names = [
  "alice", "Alice", "Bob", "bob", "Émile", "Emil", "zoe", "Zack", "Ø", "Oskar",
  "Ärger", "Anton", "Mia", "mia", "Mia", "12 Monkeys", "_under", "Zoë",
];

describe("SQL-side trade matching is equivalent to the reference implementation", () => {
  let ownerCollectorId: string;
  let ownerCollectionId: string;
  const ownerSections = Array.from({ length: sectionCount }, (_, index) => uuid("6b6b6b6b-0000-4000-8000-", index));

  beforeAll(async () => {
    await query(`TRUNCATE "user", albums, collector_profiles CASCADE`, [], pool);
    await seedAlbumTemplate(template(revisionOne, 1, "A", "6b6b6b6b-0000-4000-8000-"), pool);

    const random = prng(117);
    async function addCollector(displayName: string, visible: boolean) {
      const profile = await query<{ id: string }>(
        `INSERT INTO collector_profiles (display_name, onboarding_completed_at) VALUES ($1, now()) RETURNING id`,
        [displayName],
        pool,
      );
      const collectorId = profile.rows[0]!.id;
      const collection = await createCollection(collectorId, albumId, pool);
      // Roughly half owned, a quarter of those duplicated; sparse rows only.
      await query(
        `INSERT INTO holdings (collection_id, album_id, revision_id, sticker_id, quantity)
         SELECT $1, c.album_id, c.revision_id, rs.sticker_id, q.quantity
           FROM collections c
           JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
           JOIN unnest($2::int[]) WITH ORDINALITY AS q(quantity, position)
             ON q.position = rs.sort_order + 1
          WHERE c.id = $1 AND q.quantity > 0`,
        [
          collection.id,
          Array.from({ length: stickerCount + 1 }, () => {
            const roll = random();
            return roll < 0.5 ? 0 : roll < 0.8 ? 1 : 2 + Math.floor(random() * 3);
          }),
        ],
        pool,
      );
      await setTradingVisibility(collectorId, visible, pool);
      return { collectorId, collectionId: collection.id };
    }

    const owner = await addCollector("Owner", true);
    ownerCollectorId = owner.collectorId;
    ownerCollectionId = owner.collectionId;

    for (const [index, name] of names.entries()) {
      await addCollector(name, index % 7 !== 3); // a few hidden collectors
    }
    const archived = await addCollector("Archived partner", true);
    await query(`UPDATE collections SET status = 'archived' WHERE id = $1`, [archived.collectionId], pool);

    // Later collectors use revision two of the same logical album.
    await archiveRevision(revisionOne, pool);
    await seedAlbumTemplate(template(revisionTwo, 2, "B", "7c7c7c7c-0000-4000-8000-"), pool);
    for (let index = 0; index < 14; index += 1) {
      await addCollector(names[(index * 5) % names.length]!, true);
    }
  });

  afterAll(async () => pool.end());

  const sorts: TradeSort[] = ["compatibility", "offered", "wanted", "name"];
  const directions: TradeDirection[] = ["all", "one-way", "two-way"];

  it("matches every sort, direction, section, and page combination", async () => {
    let compared = 0;
    for (const sectionId of [undefined, ...ownerSections]) {
      for (const sort of sorts) {
        for (const direction of directions) {
          const reference = await referenceTradeMatches(
            ownerCollectorId, ownerCollectionId, { sort, direction, sectionId, limit: 50 }, pool,
          );
          for (const [limit, offset] of [[50, 0], [5, 0], [5, 5], [7, 21], [3, reference.total - 1], [5, 999]] as const) {
            if (offset < 0) continue;
            const options = { sort, direction, limit, offset, ...(sectionId ? { sectionId } : {}) };
            const expected = await referenceTradeMatches(ownerCollectorId, ownerCollectionId, options, pool);
            const actual = await calculateTradeMatches(ownerCollectorId, ownerCollectionId, options, pool);
            expect({ total: actual.total, matches: actual.matches }, JSON.stringify(options)).toEqual(expected);
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(300);
  });

  it("exercises a meaningful dataset", async () => {
    const all = await referenceTradeMatches(ownerCollectorId, ownerCollectionId, { limit: 50 }, pool);
    expect(all.total).toBeGreaterThan(20);
    expect(all.matches.some((match) => match.kind === "two-way")).toBe(true);
    expect(all.matches.some((match) => match.kind === "one-way")).toBe(true);
    expect(all.matches.some((match) => match.offersToYou.some((sticker) => sticker.code !== sticker.partnerCode))).toBe(true);
    expect(all.matches.some((match) => match.displayName === "Archived partner")).toBe(false);
  });
});
