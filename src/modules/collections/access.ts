import type { Pool } from "pg";

import { getPool } from "@/infrastructure/database";
import { listPublishedAlbums, type PublishedAlbumSummary } from "@/modules/catalog";
import { requireCollectorContext } from "@/modules/collectors";

import { exportFileName, serializeCollectionExport } from "./csv";
import {
  createCollection,
  listCollections,
  loadCollectionExport,
  loadCollectionStickers,
  removeCollection,
  setHoldingQuantity,
  type CollectionExportType,
  type CollectionSticker,
  type CollectionSummary,
} from "./repository";

type CollectorAuth = Parameters<typeof requireCollectorContext>[1];

export interface CollectionsOverview {
  collections: CollectionSummary[];
  availableAlbums: PublishedAlbumSummary[];
}

export async function getCollectionsOverview(
  headers: Headers,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<CollectionsOverview> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const [collections, albums] = await Promise.all([
    listCollections(identity.collector.id, pool),
    listPublishedAlbums(pool),
  ]);
  const activeAlbumIds = new Set(collections.map((collection) => collection.albumId));
  return {
    collections,
    availableAlbums: albums.filter((album) => !activeAlbumIds.has(album.id)),
  };
}

export async function addOwnCollection(
  headers: Headers,
  albumId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<{ id: string; revisionId: string }> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return createCollection(identity.collector.id, albumId, pool);
}

export async function removeOwnCollection(
  headers: Headers,
  collectionId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return removeCollection(identity.collector.id, collectionId, pool);
}

export async function getOwnCollectionStickers(
  headers: Headers,
  collectionId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<CollectionSticker[]> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return loadCollectionStickers(identity.collector.id, collectionId, pool);
}

export async function setOwnHoldingQuantity(
  headers: Headers,
  collectionId: string,
  stickerId: string,
  quantity: number,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const identity = await requireCollectorContext(headers, auth, pool);
  await setHoldingQuantity(identity.collector.id, collectionId, stickerId, quantity, pool);
}

/**
 * Exports the authenticated collector's own missing or duplicates list as CSV.
 * Ownership is derived from the session, never a client-supplied collector id,
 * so foreign collections are never exportable (IDOR-safe). Never includes login
 * email or authentication data.
 */
export async function exportOwnCollection(
  headers: Headers,
  collectionId: string,
  type: CollectionExportType,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<{ filename: string; content: string }> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const data = await loadCollectionExport(identity.collector.id, collectionId, type, pool);
  return { filename: exportFileName(data), content: serializeCollectionExport(data) };
}
