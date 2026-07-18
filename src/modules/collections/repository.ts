import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";

export class CollectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectionError";
  }
}

export interface CollectionSummary {
  id: string;
  albumId: string;
  albumTitle: string;
  revisionId: string;
  revisionNumber: number;
  owned: number;
  total: number;
}

export interface CollectionSticker {
  id: string;
  code: string;
  label: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  sortOrder: number;
  quantity: number;
}

export async function createCollectorProfile(
  displayName: string,
  executor?: QueryExecutor,
): Promise<{ id: string; displayName: string }> {
  const result = await query<{ id: string; display_name: string }>(
    "INSERT INTO collector_profiles (display_name) VALUES ($1) RETURNING id, display_name",
    [displayName],
    executor,
  );
  return { id: result.rows[0]!.id, displayName: result.rows[0]!.display_name };
}

export async function listCollections(
  collectorId: string,
  executor?: QueryExecutor,
): Promise<CollectionSummary[]> {
  const result = await query<{
    id: string;
    album_id: string;
    album_title: string;
    revision_id: string;
    revision_number: number;
    owned: number;
    total: number;
  }>(
    `SELECT c.id, c.album_id, a.title AS album_title, c.revision_id, r.revision_number,
            count(h.sticker_id)::integer AS owned,
            count(rs.sticker_id)::integer AS total
       FROM collections c
       JOIN albums a ON a.id = c.album_id
       JOIN album_revisions r ON r.id = c.revision_id
       JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
       LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
      WHERE c.collector_id = $1 AND c.status = 'active'
      GROUP BY c.id, a.title, r.revision_number
      ORDER BY c.created_at, c.id`,
    [collectorId],
    executor,
  );

  return result.rows.map((row) => ({
    id: row.id,
    albumId: row.album_id,
    albumTitle: row.album_title,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    owned: row.owned,
    total: row.total,
  }));
}

export async function createCollection(
  collectorId: string,
  albumId: string,
  executor?: QueryExecutor,
): Promise<{ id: string; revisionId: string }> {
  const result = await query<{ id: string; revision_id: string }>(
    `INSERT INTO collections (collector_id, album_id, revision_id)
     SELECT $1, r.album_id, r.id
       FROM album_revisions r
      WHERE r.album_id = $2 AND r.status = 'published'
     RETURNING id, revision_id`,
    [collectorId, albumId],
    executor,
  );
  const collection = result.rows[0];
  if (!collection) throw new CollectionError("No published album revision is available.");
  return { id: collection.id, revisionId: collection.revision_id };
}

export async function removeCollection(
  collectorId: string,
  collectionId: string,
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query(
    "DELETE FROM collections WHERE id = $1 AND collector_id = $2",
    [collectionId, collectorId],
    executor,
  );
  return result.rowCount === 1;
}

export async function loadCollectionStickers(
  collectorId: string,
  collectionId: string,
  executor?: QueryExecutor,
): Promise<CollectionSticker[]> {
  const result = await query<{
    id: string;
    code: string;
    label: string;
    section_id: string;
    section_code: string;
    section_name: string;
    sort_order: number;
    quantity: number;
  }>(
    `SELECT rs.sticker_id AS id, rs.code, rs.label, rs.section_id,
            s.code AS section_code, s.name AS section_name, rs.sort_order,
            COALESCE(h.quantity, 0)::integer AS quantity
       FROM collections c
       JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
       JOIN album_sections s ON s.id = rs.section_id
       LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
      WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'
      ORDER BY rs.sort_order`,
    [collectionId, collectorId],
    executor,
  );
  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    label: row.label,
    sectionId: row.section_id,
    sectionCode: row.section_code,
    sectionName: row.section_name,
    sortOrder: row.sort_order,
    quantity: row.quantity,
  }));
}

async function updateQuantity(
  client: PoolClient,
  collectorId: string,
  collectionId: string,
  stickerId: string,
  quantity: number,
): Promise<void> {
  const collection = await query<{ album_id: string; revision_id: string }>(
    `SELECT album_id, revision_id FROM collections
      WHERE id = $1 AND collector_id = $2 AND status = 'active' FOR UPDATE`,
    [collectionId, collectorId],
    client,
  );
  const current = collection.rows[0];
  if (!current) throw new CollectionError("Collection not found.");

  const membership = await query(
    `SELECT 1 FROM album_revision_stickers
      WHERE album_id = $1 AND revision_id = $2 AND sticker_id = $3`,
    [current.album_id, current.revision_id, stickerId],
    client,
  );
  if (membership.rowCount !== 1) throw new CollectionError("Sticker is not part of the collection revision.");

  if (quantity === 0) {
    await query(
      "DELETE FROM holdings WHERE collection_id = $1 AND sticker_id = $2",
      [collectionId, stickerId],
      client,
    );
    return;
  }

  await query(
    `INSERT INTO holdings (collection_id, album_id, revision_id, sticker_id, quantity)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (collection_id, sticker_id)
     DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()`,
    [collectionId, current.album_id, current.revision_id, stickerId, quantity],
    client,
  );
}

export async function setHoldingQuantity(
  collectorId: string,
  collectionId: string,
  stickerId: string,
  quantity: number,
  pool: Pool = getPool(),
): Promise<void> {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) {
    throw new CollectionError("Quantity must be an integer from 0 through 99.");
  }
  await withTransaction(
    (client) => updateQuantity(client, collectorId, collectionId, stickerId, quantity),
    pool,
  );
}
