import type { Pool } from "pg";

import { getPool } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import {
  archiveRevision,
  correctAlbumMetadata,
  importAlbumTemplate,
  listManagedAlbums,
  publishRevisionAndArchiveCurrent,
  type ManagedAlbumSummary,
  type SeedResult,
} from "@/modules/catalog";
import type { StickerfolioAuth } from "@/modules/identity";

import { requireAdmin } from "./users";

export async function listAdminAlbums(
  headers: Headers,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<ManagedAlbumSummary[]> {
  await requireAdmin(headers, auth, pool);
  return listManagedAlbums(pool);
}

export async function importAdminAlbumTemplate(
  headers: Headers,
  template: unknown,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<SeedResult> {
  await requireAdmin(headers, auth, pool);
  return importAlbumTemplate(template, pool);
}

export async function setAdminRevisionStatus(
  headers: Headers,
  revisionId: string,
  action: "publish" | "archive",
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  if (action === "publish") {
    await publishRevisionAndArchiveCurrent(revisionId, pool);
  } else {
    await archiveRevision(revisionId, pool);
  }
  writeAuditEvent(
    action === "publish" ? "album_revision.published" : "album_revision.archived",
    { type: "user", userId: actor.userId },
    { type: "album_revision", id: revisionId },
  );
}

export async function updateAdminAlbumMetadata(
  headers: Headers,
  albumId: string,
  revisionId: string,
  metadata: { title: string; description: string | null },
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  await requireAdmin(headers, auth, pool);
  await correctAlbumMetadata(albumId, revisionId, metadata, pool);
}
