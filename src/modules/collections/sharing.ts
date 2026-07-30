import { createHash, randomBytes } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { DatabaseError, getPool, query, withTransaction } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import { requireCollectorContext } from "@/modules/collectors";

import { CollectionError } from "./repository";

export const collectionShareScopes = ["missing", "duplicates", "both"] as const;
export type CollectionShareScope = (typeof collectionShareScopes)[number];
export type CollectionShareStatus = "active" | "expired" | "revoked";

export interface CollectionShareSummary {
  id: string;
  scope: CollectionShareScope;
  status: CollectionShareStatus;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SharedSticker {
  code: string;
  label: string;
  kind: "missing" | "duplicate";
  spareCount: number;
}

export interface SharedSection {
  code: string;
  name: string;
  stickers: SharedSticker[];
}

export interface SharedCollection {
  albumTitle: string;
  revisionNumber: number;
  scope: CollectionShareScope;
  expiresAt: string | null;
  sections: SharedSection[];
  missingCount: number;
  duplicateCount: number;
}

interface ShareRow {
  id: string;
  scope: CollectionShareScope;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

type CollectorAuth = Parameters<typeof requireCollectorContext>[1];

function shareStatus(row: Pick<ShareRow, "expires_at" | "revoked_at">, now: Date): CollectionShareStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at && row.expires_at <= now) return "expired";
  return "active";
}

function toSummary(row: ShareRow, now: Date): CollectionShareSummary {
  return {
    id: row.id,
    scope: row.scope,
    status: shareStatus(row, now),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isCollectionShareToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function validateScope(scope: CollectionShareScope): void {
  if (!collectionShareScopes.includes(scope)) {
    throw new CollectionError("Invalid share scope.");
  }
}

function validateDate(value: Date): void {
  if (!Number.isFinite(value.getTime())) throw new CollectionError("Invalid expiration date.");
}

async function insertCollectionShare(
  collectorId: string,
  collectionId: string,
  hash: string,
  scope: CollectionShareScope,
  expiresAt: Date | null,
  executor: Pool,
): Promise<ShareRow | undefined> {
  const result = await query<ShareRow>(
    `INSERT INTO collection_share_links (collection_id, token_hash, scope, expires_at)
     SELECT c.id, $3, $4, $5
       FROM collections c
      WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'
     RETURNING id, scope, expires_at, revoked_at, created_at, updated_at`,
    [collectionId, collectorId, hash, scope, expiresAt],
    executor,
  );
  return result.rows[0];
}

export async function createCollectionShare(
  collectorId: string,
  collectionId: string,
  scope: CollectionShareScope,
  expiresAt: Date | null,
  pool: Pool = getPool(),
  now = new Date(),
): Promise<{ share: CollectionShareSummary; token: string }> {
  validateScope(scope);
  if (expiresAt) {
    validateDate(expiresAt);
    if (expiresAt <= now) throw new CollectionError("Expiration must be in the future.");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateToken();
    try {
      const row = await insertCollectionShare(
        collectorId,
        collectionId,
        tokenHash(token),
        scope,
        expiresAt,
        pool,
      );
      if (!row) throw new CollectionError("Collection not found.", 404);
      return { share: toSummary(row, now), token };
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505") continue;
      throw error;
    }
  }
  throw new CollectionError("The share link could not be created.", 409);
}

export async function listCollectionShares(
  collectorId: string,
  collectionId: string,
  executor: Pool = getPool(),
  now = new Date(),
): Promise<CollectionShareSummary[]> {
  const collection = await query(
    `SELECT 1 FROM collections
      WHERE id = $1 AND collector_id = $2 AND status = 'active'`,
    [collectionId, collectorId],
    executor,
  );
  if (collection.rowCount !== 1) throw new CollectionError("Collection not found.", 404);

  const result = await query<ShareRow>(
    `SELECT sl.id, sl.scope, sl.expires_at, sl.revoked_at, sl.created_at, sl.updated_at
       FROM collection_share_links sl
      WHERE sl.collection_id = $1
      ORDER BY sl.created_at DESC, sl.id`,
    [collectionId],
    executor,
  );
  return result.rows.map((row) => toSummary(row, now));
}

export async function updateCollectionShare(
  collectorId: string,
  collectionId: string,
  shareId: string,
  input: { scope?: CollectionShareScope; expiresAt?: Date | null },
  executor: Pool = getPool(),
  now = new Date(),
): Promise<CollectionShareSummary> {
  if (input.scope) validateScope(input.scope);
  if (input.expiresAt) validateDate(input.expiresAt);
  if (input.scope === undefined && input.expiresAt === undefined) {
    throw new CollectionError("No share changes were provided.");
  }

  const result = await query<ShareRow>(
    `UPDATE collection_share_links sl
        SET scope = COALESCE($4, sl.scope),
            expires_at = CASE WHEN $5 THEN $6 ELSE sl.expires_at END,
            updated_at = now()
       FROM collections c
      WHERE sl.id = $1
        AND sl.collection_id = $2
        AND c.id = sl.collection_id
        AND c.collector_id = $3
        AND c.status = 'active'
        AND sl.revoked_at IS NULL
        AND (sl.expires_at IS NULL OR sl.expires_at > $7)
     RETURNING sl.id, sl.scope, sl.expires_at, sl.revoked_at, sl.created_at, sl.updated_at`,
    [
      shareId,
      collectionId,
      collectorId,
      input.scope ?? null,
      input.expiresAt !== undefined,
      input.expiresAt ?? null,
      now,
    ],
    executor,
  );
  const row = result.rows[0];
  if (!row) throw new CollectionError("Share link not found.", 404);
  return toSummary(row, now);
}

export async function revokeCollectionShare(
  collectorId: string,
  collectionId: string,
  shareId: string,
  executor: Pool = getPool(),
): Promise<boolean> {
  const result = await query(
    `UPDATE collection_share_links sl
        SET revoked_at = now(), updated_at = now()
       FROM collections c
      WHERE sl.id = $1
        AND sl.collection_id = $2
        AND c.id = sl.collection_id
        AND c.collector_id = $3
        AND c.status = 'active'
        AND sl.revoked_at IS NULL`,
    [shareId, collectionId, collectorId],
    executor,
  );
  return result.rowCount === 1;
}

async function loadSharedCollectionInTransaction(
  client: PoolClient,
  hash: string,
  now: Date,
): Promise<SharedCollection | null> {
  const metaResult = await query<{
    collection_id: string;
    revision_id: string;
    album_title: string;
    revision_number: number;
    scope: CollectionShareScope;
    expires_at: Date | null;
  }>(
    `SELECT c.id AS collection_id, c.revision_id, a.title AS album_title,
            r.revision_number, sl.scope, sl.expires_at
       FROM collection_share_links sl
       JOIN collections c ON c.id = sl.collection_id
       JOIN albums a ON a.id = c.album_id
       JOIN album_revisions r ON r.id = c.revision_id
      WHERE sl.token_hash = $1
        AND sl.revoked_at IS NULL
        AND (sl.expires_at IS NULL OR sl.expires_at > $2)
        AND c.status = 'active'`,
    [hash, now],
    client,
  );
  const meta = metaResult.rows[0];
  if (!meta) return null;

  const stickersResult = await query<{
    section_code: string;
    section_name: string;
    code: string;
    label: string;
    quantity: number;
  }>(
    `SELECT s.code AS section_code, s.name AS section_name, rs.code, rs.label,
            COALESCE(h.quantity, 0)::integer AS quantity
       FROM album_revision_stickers rs
       JOIN album_sections s ON s.id = rs.section_id
       LEFT JOIN holdings h
         ON h.collection_id = $1 AND h.sticker_id = rs.sticker_id
      WHERE rs.revision_id = $2
        AND (
          ($3 IN ('missing', 'both') AND h.sticker_id IS NULL)
          OR ($3 IN ('duplicates', 'both') AND h.quantity > 1)
        )
      ORDER BY s.sort_order, rs.sort_order, rs.code`,
    [meta.collection_id, meta.revision_id, meta.scope],
    client,
  );

  const sections = new Map<string, SharedSection>();
  let missingCount = 0;
  let duplicateCount = 0;
  for (const sticker of stickersResult.rows) {
    const kind = sticker.quantity > 1 ? "duplicate" : "missing";
    if (kind === "missing") missingCount += 1;
    else duplicateCount += 1;
    const key = `${sticker.section_code}\u0000${sticker.section_name}`;
    const section = sections.get(key) ?? {
      code: sticker.section_code,
      name: sticker.section_name,
      stickers: [],
    };
    section.stickers.push({
      code: sticker.code,
      label: sticker.label,
      kind,
      spareCount: kind === "duplicate" ? sticker.quantity - 1 : 0,
    });
    sections.set(key, section);
  }

  return {
    albumTitle: meta.album_title,
    revisionNumber: meta.revision_number,
    scope: meta.scope,
    expiresAt: meta.expires_at?.toISOString() ?? null,
    sections: [...sections.values()],
    missingCount,
    duplicateCount,
  };
}

export async function loadSharedCollection(
  token: string,
  pool: Pool = getPool(),
  now = new Date(),
): Promise<SharedCollection | null> {
  if (!isCollectionShareToken(token)) return null;
  return withTransaction(async (client) => {
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [], client);
    return loadSharedCollectionInTransaction(client, tokenHash(token), now);
  }, pool);
}

export async function createOwnCollectionShare(
  headers: Headers,
  collectionId: string,
  scope: CollectionShareScope,
  expiresAt: Date | null,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<{ share: CollectionShareSummary; token: string }> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const created = await createCollectionShare(
    identity.collector.id,
    collectionId,
    scope,
    expiresAt,
    pool,
  );
  writeAuditEvent(
    "collection_share.created",
    { type: "user", userId: identity.userId },
    { type: "collection_share", id: created.share.id },
    { scope, expiring: expiresAt !== null },
  );
  return created;
}

export async function getOwnCollectionShares(
  headers: Headers,
  collectionId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<CollectionShareSummary[]> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return listCollectionShares(identity.collector.id, collectionId, pool);
}

export async function updateOwnCollectionShare(
  headers: Headers,
  collectionId: string,
  shareId: string,
  input: { scope?: CollectionShareScope; expiresAt?: Date | null },
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<CollectionShareSummary> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const updated = await updateCollectionShare(
    identity.collector.id,
    collectionId,
    shareId,
    input,
    pool,
  );
  writeAuditEvent(
    "collection_share.updated",
    { type: "user", userId: identity.userId },
    { type: "collection_share", id: updated.id },
    {
      scopeChanged: input.scope !== undefined,
      expirationChanged: input.expiresAt !== undefined,
    },
  );
  return updated;
}

export async function revokeOwnCollectionShare(
  headers: Headers,
  collectionId: string,
  shareId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const revoked = await revokeCollectionShare(
    identity.collector.id,
    collectionId,
    shareId,
    pool,
  );
  if (revoked) {
    writeAuditEvent(
      "collection_share.revoked",
      { type: "user", userId: identity.userId },
      { type: "collection_share", id: shareId },
    );
  }
  return revoked;
}
