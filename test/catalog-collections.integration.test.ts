import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { archiveRevision, getCurrentRevision, seedAlbumTemplate } from "@/modules/catalog";
import {
  CollectionError,
  createCollection,
  createCollectorProfile,
  listCollections,
  loadCollectionStickers,
  setHoldingQuantity,
} from "@/modules/collections";

import { createTestEnvironment } from "./create-test-environment";

const pool = createPool(createTestEnvironment(inject("databaseUrl")));

const albumId = "16cdf0a0-d4d7-5e58-8e49-f2c8455be4fb";
const firstRevisionId = "017b7165-f89f-55aa-a2ca-4139b59bfbca";
const firstSectionId = "26bdb46d-24f4-59f1-ae22-343473f7baef";
const firstStickerId = "06cdf614-184d-5e91-a65f-3f9d40f5fb50";
const secondStickerId = "2d650325-13a1-59ef-8607-2c6cb59f8a55";

const firstTemplate = {
  formatVersion: 1 as const,
  album: { id: albumId, slug: "integration-album", title: "Integration album" },
  revision: { id: firstRevisionId, number: 1, label: "First", status: "published" as const },
  sections: [{ id: firstSectionId, code: "ONE", name: "One", sortOrder: 0 }],
  stickers: [
    { stableId: firstStickerId, stableKey: "one", sectionId: firstSectionId, code: "ONE1", label: "One", sortOrder: 0 },
    { stableId: secondStickerId, stableKey: "two", sectionId: firstSectionId, code: "ONE2", label: "Two", sortOrder: 1 },
  ],
};

describe("revision-aware catalog and sparse collections", () => {
  let collectorId: string;
  let collectionId: string;

  beforeAll(async () => {
    await query("TRUNCATE albums, collector_profiles CASCADE", [], pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("seeds a published revision atomically and idempotently", async () => {
    await expect(seedAlbumTemplate(firstTemplate, pool)).resolves.toMatchObject({ created: true, stickers: 2 });
    await expect(seedAlbumTemplate(firstTemplate, pool)).resolves.toMatchObject({ created: false, stickers: 2 });
    await expect(getCurrentRevision(albumId, pool)).resolves.toEqual({ id: firstRevisionId, revisionNumber: 1 });
  });

  it("prevents structural changes to a published revision", async () => {
    await expect(
      query("UPDATE album_revision_stickers SET code = $1 WHERE revision_id = $2 AND sticker_id = $3", ["CHANGED", firstRevisionId, firstStickerId], pool),
    ).rejects.toThrow("database operation failed");
  });

  it("creates one collection on the current revision", async () => {
    const collector = await createCollectorProfile("Integration collector", pool);
    collectorId = collector.id;
    const collection = await createCollection(collectorId, albumId, pool);
    collectionId = collection.id;

    expect(collection.revisionId).toBe(firstRevisionId);
    await expect(createCollection(collectorId, albumId, pool)).rejects.toThrow();
    await expect(listCollections(collectorId, pool)).resolves.toMatchObject([{ owned: 0, total: 2 }]);
  });

  it("stores only positive quantities and treats missing rows as zero", async () => {
    await setHoldingQuantity(collectorId, collectionId, firstStickerId, 2, pool);
    let stickers = await loadCollectionStickers(collectorId, collectionId, pool);
    expect(stickers.find((sticker) => sticker.id === firstStickerId)?.quantity).toBe(2);

    await setHoldingQuantity(collectorId, collectionId, firstStickerId, 0, pool);
    stickers = await loadCollectionStickers(collectorId, collectionId, pool);
    expect(stickers.find((sticker) => sticker.id === firstStickerId)?.quantity).toBe(0);
    const rows = await query<{ count: string }>("SELECT count(*)::text AS count FROM holdings WHERE collection_id = $1", [collectionId], pool);
    expect(rows.rows[0]?.count).toBe("0");
  });

  it("rejects invalid quantities and stickers outside the revision", async () => {
    await expect(setHoldingQuantity(collectorId, collectionId, firstStickerId, 100, pool)).rejects.toBeInstanceOf(CollectionError);
    await expect(
      setHoldingQuantity(collectorId, collectionId, "daa0ed98-cf2f-50da-a524-3b0c70e84d23", 1, pool),
    ).rejects.toBeInstanceOf(CollectionError);
  });

  it("keeps existing collections pinned while new collectors use the new revision", async () => {
    await archiveRevision(firstRevisionId, pool);
    const secondRevisionId = "4e12ea72-f34d-5eb3-8674-23cfac59e7c6";
    const secondSectionId = "8aa7213a-4834-5897-bff8-cdee7ab35295";
    await seedAlbumTemplate(
      {
        ...firstTemplate,
        revision: { id: secondRevisionId, number: 2, label: "Second", status: "published" },
        sections: [{ id: secondSectionId, code: "NEW", name: "New", sortOrder: 0 }],
        stickers: [
          { stableId: firstStickerId, stableKey: "one", sectionId: secondSectionId, code: "NEW1", label: "One", sortOrder: 0 },
        ],
      },
      pool,
    );

    const otherCollector = await createCollectorProfile("Other collector", pool);
    const newCollection = await createCollection(otherCollector.id, albumId, pool);
    expect(newCollection.revisionId).toBe(secondRevisionId);
    expect((await listCollections(collectorId, pool))[0]?.revisionId).toBe(firstRevisionId);
  });
});
