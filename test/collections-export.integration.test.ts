import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";
import {
  CollectionError,
  createCollection,
  createCollectorProfile,
  exportFileName,
  loadCollectionExport,
  serializeCollectionExport,
  setHoldingQuantity,
} from "@/modules/collections";

import { createTestEnvironment } from "./create-test-environment";

const pool = createPool(createTestEnvironment(inject("databaseUrl")));

const albumId = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3d4e5f";
const revisionId = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3d4e60";
const sectionA = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3d4a00";
const sectionB = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3d4b00";
const stA1 = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3da101";
const stA2 = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3da102";
const stA3 = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3da103";
const stB1 = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3db101";
const stB2 = "3f0e1d2c-4b5a-4c6d-8e9f-0a1b2c3db102";

const template = {
  formatVersion: 1 as const,
  album: { id: albumId, slug: "export-album", title: "Export album" },
  revision: { id: revisionId, number: 1, label: "First", status: "published" as const },
  sections: [
    { id: sectionA, code: "A", name: "Team A", sortOrder: 0 },
    { id: sectionB, code: "B", name: "Team B", sortOrder: 1 },
  ],
  stickers: [
    { stableId: stA1, stableKey: "a1", sectionId: sectionA, code: "A1", label: "Sticker A1", sortOrder: 0 },
    { stableId: stA2, stableKey: "a2", sectionId: sectionA, code: "A2", label: "Sticker A2", sortOrder: 1 },
    { stableId: stA3, stableKey: "a3", sectionId: sectionA, code: "A3", label: "Sticker A3", sortOrder: 2 },
    { stableId: stB1, stableKey: "b1", sectionId: sectionB, code: "B1", label: "Sticker B1", sortOrder: 3 },
    { stableId: stB2, stableKey: "b2", sectionId: sectionB, code: "B2", label: "Sticker B2", sortOrder: 4 },
  ],
};

describe("CSV export of missing and duplicate lists", () => {
  let collectorId: string;
  let collectionId: string;

  beforeAll(async () => {
    await query("TRUNCATE albums, collector_profiles CASCADE", [], pool);
    await seedAlbumTemplate(template, pool);
    collectorId = (await createCollectorProfile("Export collector", pool)).id;
    collectionId = (await createCollection(collectorId, albumId, pool)).id;
    await setHoldingQuantity(collectorId, collectionId, stA1, 2, pool);
    await setHoldingQuantity(collectorId, collectionId, stA2, 1, pool);
    await setHoldingQuantity(collectorId, collectionId, stB1, 3, pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("derives the missing list (quantity 0) in deterministic order", async () => {
    const missing = await loadCollectionExport(collectorId, collectionId, "missing", pool);
    expect(missing.stickers.map((sticker) => sticker.code)).toEqual(["A3", "B2"]);
    expect(serializeCollectionExport(missing)).toBe(
      "code,name,section_code,section\r\nA3,Sticker A3,A,Team A\r\nB2,Sticker B2,B,Team B\r\n",
    );
    expect(exportFileName(missing)).toBe("export-album-missing.csv");
  });

  it("derives the duplicates list (quantity > 1) with spare_count", async () => {
    const duplicates = await loadCollectionExport(collectorId, collectionId, "duplicates", pool);
    expect(duplicates.stickers).toEqual([
      expect.objectContaining({ code: "A1", quantity: 2, spareCount: 1 }),
      expect.objectContaining({ code: "B1", quantity: 3, spareCount: 2 }),
    ]);
    expect(serializeCollectionExport(duplicates)).toBe(
      "code,name,section_code,section,quantity,spare_count\r\nA1,Sticker A1,A,Team A,2,1\r\nB1,Sticker B1,B,Team B,3,2\r\n",
    );
    expect(exportFileName(duplicates)).toBe("export-album-duplicates.csv");
  });

  it("returns a valid header-only CSV when a list is empty", async () => {
    const other = await createCollectorProfile("Empty collector", pool);
    const emptyCollection = await createCollection(other.id, albumId, pool);
    const duplicates = await loadCollectionExport(other.id, emptyCollection.id, "duplicates", pool);
    expect(duplicates.stickers).toEqual([]);
    expect(serializeCollectionExport(duplicates)).toBe(
      "code,name,section_code,section,quantity,spare_count\r\n",
    );
  });

  it("never exports a collection owned by another collector", async () => {
    const intruder = await createCollectorProfile("Intruder", pool);
    await expect(
      loadCollectionExport(intruder.id, collectionId, "missing", pool),
    ).rejects.toBeInstanceOf(CollectionError);
  });
});
