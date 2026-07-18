import { afterAll, describe, expect, inject, it } from "vitest";

import { wm2026ExampleHoldings } from "@/data/examples/wm2026-example-holdings";
import { wm2026Template } from "@/data/wm2026";
import { createPool, query } from "@/infrastructure/database";
import { seedAlbumTemplate } from "@/modules/catalog";
import { createCollectorProfile, seedExampleHoldings } from "@/modules/collections";

import { createTestEnvironment } from "./create-test-environment";

const pool = createPool(createTestEnvironment(inject("databaseUrl")));

describe("explicit World Cup 2026 seeds", () => {
  afterAll(async () => pool.end());

  it("creates exactly one verified catalog and is idempotent", async () => {
    await expect(seedAlbumTemplate(wm2026Template, pool)).resolves.toMatchObject({ created: true, stickers: 994 });
    await expect(seedAlbumTemplate(wm2026Template, pool)).resolves.toMatchObject({ created: false, stickers: 994 });

    const counts = await query<{ albums: number; stickers: number }>(
      `SELECT count(DISTINCT a.id)::integer AS albums, count(rs.sticker_id)::integer AS stickers
         FROM albums a
         JOIN album_revisions r ON r.album_id = a.id
         JOIN album_revision_stickers rs ON rs.revision_id = r.id
        WHERE a.id = $1`,
      [wm2026Template.album.id],
      pool,
    );
    expect(counts.rows[0]).toEqual({ albums: 1, stickers: 994 });
  });

  it("loads example holdings only into one explicit existing collector without overwriting", async () => {
    const collector = await createCollectorProfile("Seed target", pool);
    const expected = Object.keys(wm2026ExampleHoldings.quantities).length;
    const first = await seedExampleHoldings(collector.id, wm2026ExampleHoldings, pool);
    expect(first).toMatchObject({ collectionCreated: true, inserted: expected, skipped: 0 });

    const firstStickerCode = Object.keys(wm2026ExampleHoldings.quantities)[0]!;
    await query(
      `UPDATE holdings h SET quantity = 9
        FROM album_revision_stickers rs
       WHERE h.collection_id = $1 AND h.sticker_id = rs.sticker_id AND rs.code = $2`,
      [first.collectionId, firstStickerCode],
      pool,
    );
    const repeated = await seedExampleHoldings(collector.id, wm2026ExampleHoldings, pool);
    expect(repeated).toMatchObject({ collectionCreated: false, inserted: 0, skipped: expected });

    const preserved = await query<{ quantity: number }>(
      `SELECT h.quantity FROM holdings h
        JOIN album_revision_stickers rs ON rs.sticker_id = h.sticker_id AND rs.revision_id = h.revision_id
       WHERE h.collection_id = $1 AND rs.code = $2`,
      [first.collectionId, firstStickerCode],
      pool,
    );
    expect(preserved.rows[0]?.quantity).toBe(9);
  });

  it("aborts an unknown target without creating a collection", async () => {
    const before = await query<{ count: string }>("SELECT count(*)::text AS count FROM collections", [], pool);
    await expect(
      seedExampleHoldings("8e880a04-e891-5c36-bc7f-d0caefb1d4d8", wm2026ExampleHoldings, pool),
    ).rejects.toThrow("does not exist");
    const after = await query<{ count: string }>("SELECT count(*)::text AS count FROM collections", [], pool);
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
