import type { Pool } from "pg";

import { DatabaseError, getPool, withTransaction } from "@/infrastructure/database";
import { listPublishedAlbums, type PublishedAlbumSummary } from "@/modules/catalog";
import {
  markCollectorOnboardingComplete,
  updateCollectorDisplayName,
} from "@/modules/collectors";
import { type Principal, requireCollectorPrincipal } from "@/shared/principal";

import { exportFileName, serializeCollectionExport } from "./csv";
import {
  changeHoldingQuantity,
  CollectionError,
  createCollection,
  listCollections,
  loadCollectionExport,
  loadCollectionStickers,
  removeCollection,
  setHoldingQuantity,
  type CollectionExportType,
  type HoldingChange,
  type CollectionSticker,
  type CollectionSummary,
} from "./repository";


export interface CollectionsOverview {
  collections: CollectionSummary[];
  availableAlbums: PublishedAlbumSummary[];
}

export interface OnboardingResult {
  collections: { id: string; albumId: string }[];
}

export async function getCollectionsOverview(
  principal: Principal | null,
  pool: Pool = getPool(),
): Promise<CollectionsOverview> {
  const identity = requireCollectorPrincipal(principal);
  const [collections, albums] = await Promise.all([
    listCollections(identity.collectorId, pool),
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
  principal: Principal | null,
  input: { displayName: string; albumIds: string[] },
  pool: Pool = getPool(),
): Promise<OnboardingResult> {
  const identity = requireCollectorPrincipal(principal);
  const displayName = input.displayName.trim();
  if (displayName.length < 1 || displayName.length > 100) {
    throw new CollectionError("A display name is required.");
  }
  const albumIds = [...new Set(input.albumIds)];
  try {
    return await withTransaction(async (client) => {
      await updateCollectorDisplayName(identity.collectorId, displayName, client);
      const collections: { id: string; albumId: string }[] = [];
      for (const albumId of albumIds) {
        const created = await createCollection(identity.collectorId, albumId, client);
        collections.push({ id: created.id, albumId });
      }
      // Server-authoritative onboarding-completion flag, set inside the same
      // transaction so a completion (including a deliberate zero-album one) is
      // atomic with the created collections. A repeated or manipulated
      // submission that re-selects an already-owned album trips the
      // collections_one_active_album unique constraint; translate that into a
      // clean domain conflict instead of leaking a 500.
      await markCollectorOnboardingComplete(identity.collectorId, client);
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
  principal: Principal | null,
  albumId: string,
  pool: Pool = getPool(),
): Promise<{ id: string; revisionId: string }> {
  const identity = requireCollectorPrincipal(principal);
  return createCollection(identity.collectorId, albumId, pool);
}

export async function removeOwnCollection(
  principal: Principal | null,
  collectionId: string,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = requireCollectorPrincipal(principal);
  return removeCollection(identity.collectorId, collectionId, pool);
}

export async function getOwnCollectionStickers(
  principal: Principal | null,
  collectionId: string,
  pool: Pool = getPool(),
): Promise<CollectionSticker[]> {
  const identity = requireCollectorPrincipal(principal);
  return loadCollectionStickers(identity.collectorId, collectionId, pool);
}

export async function setOwnHoldingQuantity(
  principal: Principal | null,
  collectionId: string,
  stickerId: string,
  quantity: number,
  pool: Pool = getPool(),
): Promise<void> {
  const identity = requireCollectorPrincipal(principal);
  await setHoldingQuantity(identity.collectorId, collectionId, stickerId, quantity, pool);
}

/** Applies a relative or checked absolute change to an own holding (#127). */
export async function changeOwnHoldingQuantity(
  principal: Principal | null,
  collectionId: string,
  stickerId: string,
  change: HoldingChange,
  pool: Pool = getPool(),
): Promise<number> {
  const identity = requireCollectorPrincipal(principal);
  return changeHoldingQuantity(identity.collectorId, collectionId, stickerId, change, pool);
}

/**
 * Exports the authenticated collector's own missing or duplicates list as CSV.
 * Ownership is derived from the session, never a client-supplied collector id,
 * so foreign collections are never exportable (IDOR-safe). Never includes login
 * email or authentication data.
 */
export async function exportOwnCollection(
  principal: Principal | null,
  collectionId: string,
  type: CollectionExportType,
  pool: Pool = getPool(),
): Promise<{ filename: string; content: string }> {
  const identity = requireCollectorPrincipal(principal);
  const data = await loadCollectionExport(identity.collectorId, collectionId, type, pool);
  return { filename: exportFileName(data), content: serializeCollectionExport(data) };
}
