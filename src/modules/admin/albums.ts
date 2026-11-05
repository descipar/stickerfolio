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
import type { Principal } from "@/shared/principal";

import { requireAdmin } from "./users";

export async function listAdminAlbums(
  principal: Principal | null,
  pool: Pool = getPool(),
): Promise<ManagedAlbumSummary[]> {
  requireAdmin(principal);
  return listManagedAlbums(pool);
}

export async function importAdminAlbumTemplate(
  principal: Principal | null,
  template: unknown,
  pool: Pool = getPool(),
): Promise<SeedResult> {
  requireAdmin(principal);
  return importAlbumTemplate(template, pool);
}

export async function setAdminRevisionStatus(
  principal: Principal | null,
  revisionId: string,
  action: "publish" | "archive",
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
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
  principal: Principal | null,
  albumId: string,
  revisionId: string,
  metadata: { title: string; description: string | null },
  pool: Pool = getPool(),
): Promise<void> {
  requireAdmin(principal);
  await correctAlbumMetadata(albumId, revisionId, metadata, pool);
}
