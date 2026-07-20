import type { Pool } from "pg";

import { DatabaseError, getPool, withTransaction } from "@/infrastructure/database";
import { listPublishedAlbums, type PublishedAlbumSummary } from "@/modules/catalog";
import {
  markCollectorOnboardingComplete,
  requireCollectorContext,
  updateCollectorDisplayName,
} from "@/modules/collectors";

import { exportFileName, serializeCollectionExport } from "./csv";
import {
  CollectionError,
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

export interface OnboardingResult {
  collections: { id: string; albumId: string }[];
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

/**
 * Completes onboarding for the authenticated collector: it confirms (or updates)
 * the display name and creates one empty personal collection per selected album,
 * all inside a single transaction so multiple albums are created atomically and
 * a partial failure creates none. The collector profile already exists from
 * registration, so onboarding never creates it. An empty selection creates no
 * collection (no accidental collection). Only currently published album
 * revisions can be selected: createCollection resolves the current published
 * revision and rejects anything else. Ownership comes from the session, never a
 * client-supplied collector id.
 */
export async function completeOnboarding(
  headers: Headers,
  input: { displayName: string; albumIds: string[] },
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<OnboardingResult> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 100) {
    throw new CollectionError("A display name is required.");
  }
  const albumIds = [...new Set(input.albumIds)];
  try {
    return await withTransaction(async (client) => {
      await updateCollectorDisplayName(identity.collector.id, displayName, client);
      const collections: { id: string; albumId: string }[] = [];
      for (const albumId of albumIds) {
        const created = await createCollection(identity.collector.id, albumId, client);
        collections.push({ id: created.id, albumId });
      }
      // Server-authoritative onboarding-completion flag, set inside the same
      // transaction so a completion (including a deliberate zero-album one) is
      // atomic with the created collections. A repeated or manipulated
      // submission that re-selects an already-owned album trips the
      // collections_one_active_album unique constraint; translate that into a
      // clean domain conflict instead of leaking a 500.
      await markCollectorOnboardingComplete(identity.collector.id, client);
      return { collections };
    }, pool);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new CollectionError("You already have a collection for one of the selected albums.", 409);
    }
    throw error;
  }
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
