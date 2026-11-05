import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createPool, query } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";
import {
  changeHoldingQuantity,
  CollectionError,
  createCollection,
  createCollectorProfile,
  HoldingConflictError,
} from "@/modules/collections";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));
// Several connections, so concurrent requests really run in parallel.
const pool = createPool({ ...environment, database: { ...environment.database, poolMax: 8 } });

const albumId = "9d0f7a43-27a4-5d2b-a7a8-6a3f0a2c1b11";
const revisionId = "4f1f2a66-1a0c-5b1d-9a3a-1d2a9f0c7e21";
const sectionId = "1c2b3a4d-5e6f-5a7b-8c9d-0e1f2a3b4c5d";
const stickerId = "7a6b5c4d-3e2f-5a1b-9c8d-7e6f5a4b3c2d";

async function stored(collectionId: string): Promise<number> {
  const result = await query<{ quantity: number }>(
    "SELECT quantity FROM holdings WHERE collection_id = $1 AND sticker_id = $2",
    [collectionId, stickerId],
    pool,
  );
  return result.rows[0]?.quantity ?? 0;
}

describe("concurrent holding updates (#127)", () => {
  let collectorId: string;
  let collectionId: string;

  beforeAll(async () => {
    await query("TRUNCATE albums, collector_profiles CASCADE", [], pool);
    await seedAlbumTemplate({
      formatVersion: 1,
      album: { id: albumId, slug: "concurrency", title: "Concurrency album" },
      revision: { id: revisionId, number: 1, label: "First", status: "published" },
      sections: [{ id: sectionId, code: "A", name: "A", sortOrder: 0 }],
      stickers: [{ stableId: stickerId, stableKey: "a1", sectionId, code: "A1", label: "A1", sortOrder: 0 }],
    }, pool);
    collectorId = (await createCollectorProfile("Concurrent collector", pool)).id;
    collectionId = (await createCollection(collectorId, albumId, pool)).id;
  });

  afterAll(async () => pool.end());

  it("applies every concurrent increment from several clients", async () => {
    await Promise.all(
      Array.from({ length: 12 }, () =>
        changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: 1 }, pool),
      ),
    );
    expect(await stored(collectionId)).toBe(12);

    const results = await Promise.all([
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: -5 }, pool),
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: 2 }, pool),
    ]);
    expect(await stored(collectionId)).toBe(9);
    expect(results.sort((a, b) => a - b)).toEqual(expect.arrayContaining([9]));
  });

  it("clamps relative changes to 0 through 99 and deletes the row at zero", async () => {
    await expect(
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: 99 }, pool),
    ).resolves.toBe(99);
    await expect(
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: -99 }, pool),
    ).resolves.toBe(0);
    const rows = await query("SELECT 1 FROM holdings WHERE collection_id = $1", [collectionId], pool);
    expect(rows.rowCount).toBe(0);
    await expect(
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "add", delta: -1 }, pool),
    ).resolves.toBe(0);
  });

  it("lets exactly one of two concurrent checked writes win and reports the current value", async () => {
    await changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "set", quantity: 2 }, pool);
    const outcomes = await Promise.allSettled([
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "set", quantity: 3, expectedQuantity: 2 }, pool),
      changeHoldingQuantity(collectorId, collectionId, stickerId, { type: "set", quantity: 5, expectedQuantity: 2 }, pool),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const conflict = rejected[0]!.reason as HoldingConflictError;
    expect(conflict).toBeInstanceOf(HoldingConflictError);
    expect(conflict.status).toBe(409);
    const winner = (fulfilled[0] as PromiseFulfilledResult<number>).value;
    expect(conflict.currentQuantity).toBe(winner);
    expect(await stored(collectionId)).toBe(winner);
  });

  it("rejects invalid changes before touching the database", async () => {
    for (const change of [
      { type: "add", delta: 0 },
      { type: "add", delta: 100 },
      { type: "add", delta: 1.5 },
      { type: "set", quantity: 100 },
      { type: "set", quantity: 1, expectedQuantity: -1 },
    ] as const) {
      await expect(changeHoldingQuantity(collectorId, collectionId, stickerId, change, pool)).rejects.toBeInstanceOf(
        CollectionError,
      );
    }
  });
});
