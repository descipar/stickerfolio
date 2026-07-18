import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";

import { CollectionError } from "./repository";

export interface ExampleHoldingsDataset {
  id: string;
  albumId: string;
  revisionId: string;
  quantities: Readonly<Record<string, number>>;
}

export interface ExampleHoldingsSeedResult {
  collectionId: string;
  collectionCreated: boolean;
  inserted: number;
  skipped: number;
}

async function seed(
  client: PoolClient,
  collectorId: string,
  dataset: ExampleHoldingsDataset,
): Promise<ExampleHoldingsSeedResult> {
  const collector = await query("SELECT 1 FROM collector_profiles WHERE id = $1", [collectorId], client);
  if (collector.rowCount !== 1) throw new CollectionError("The selected collector profile does not exist.");

  const revision = await query(
    `SELECT 1 FROM album_revisions
      WHERE id = $1 AND album_id = $2 AND status = 'published'`,
    [dataset.revisionId, dataset.albumId],
    client,
  );
  if (revision.rowCount !== 1) {
    throw new CollectionError("The example dataset's published album revision is not installed.");
  }

  let collection = await query<{ id: string; revision_id: string }>(
    `SELECT id, revision_id FROM collections
      WHERE collector_id = $1 AND album_id = $2 AND status = 'active' FOR UPDATE`,
    [collectorId, dataset.albumId],
    client,
  );
  let collectionCreated = false;
  if (!collection.rows[0]) {
    collection = await query<{ id: string; revision_id: string }>(
      `INSERT INTO collections (collector_id, album_id, revision_id)
       VALUES ($1, $2, $3) RETURNING id, revision_id`,
      [collectorId, dataset.albumId, dataset.revisionId],
      client,
    );
    collectionCreated = true;
  }

  const target = collection.rows[0]!;
  if (target.revision_id !== dataset.revisionId) {
    throw new CollectionError("The collector's existing collection uses a different album revision.");
  }

  const entries = Object.entries(dataset.quantities);
  if (entries.some(([, quantity]) => !Number.isInteger(quantity) || quantity < 1 || quantity > 99)) {
    throw new CollectionError("Example holdings quantities must be integers from 1 through 99.");
  }
  const stickerCodes = entries.map(([code]) => code);
  const quantities = entries.map(([, quantity]) => quantity);
  const known = await query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM album_revision_stickers
      WHERE revision_id = $1 AND code = ANY($2::text[])`,
    [dataset.revisionId, stickerCodes],
    client,
  );
  if (known.rows[0]?.count !== entries.length) {
    throw new CollectionError("The example dataset contains stickers outside its album revision.");
  }

  const inserted = await query(
    `INSERT INTO holdings (collection_id, album_id, revision_id, sticker_id, quantity)
     SELECT $1, $2, $3, rs.sticker_id, input.quantity
       FROM unnest($4::text[], $5::smallint[]) AS input(code, quantity)
       JOIN album_revision_stickers rs ON rs.revision_id = $3 AND rs.code = input.code
     ON CONFLICT (collection_id, sticker_id) DO NOTHING`,
    [target.id, dataset.albumId, dataset.revisionId, stickerCodes, quantities],
    client,
  );

  return {
    collectionId: target.id,
    collectionCreated,
    inserted: inserted.rowCount ?? 0,
    skipped: entries.length - (inserted.rowCount ?? 0),
  };
}

export async function seedExampleHoldings(
  collectorId: string,
  dataset: ExampleHoldingsDataset,
  pool: Pool = getPool(),
): Promise<ExampleHoldingsSeedResult> {
  return withTransaction((client) => seed(client, collectorId, dataset), pool);
}
