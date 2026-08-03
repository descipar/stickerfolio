import { createHash, randomBytes, randomInt } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import {
  DatabaseError,
  getPool,
  query,
  withTransaction,
  type QueryExecutor,
} from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import { requireCollectorContext } from "@/modules/collectors";

import type { TradeSticker } from "./matching";

const comparisonCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const comparisonCodeLength = 10;
const comparisonLifetimeMs = 15 * 60 * 1000;

export type ComparisonGrantStatus = "active" | "expired" | "revoked";

export interface ComparisonGrantSummary {
  id: string;
  status: ComparisonGrantStatus;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface ComparisonCredential {
  token?: string;
  code?: string;
}

export interface ComparisonCollectionOption {
  id: string;
  albumTitle: string;
  revisionNumber: number;
}

export interface ComparisonSetup {
  collections: ComparisonCollectionOption[];
}

export interface DirectComparisonResult {
  albumTitle: string;
  partnerDisplayName: string;
  kind: "none" | "one-way" | "two-way";
  offersToYou: TradeSticker[];
  needsFromYou: TradeSticker[];
  offeredCount: number;
  wantedCount: number;
}

interface GrantRow {
  id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

interface ActiveGrantRow {
  collection_id: string;
  owner_collector_id: string;
  album_id: string;
}

interface DirectMatchRow {
  viewer_code: string;
  partner_code: string;
  viewer_label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  viewer_quantity: number;
  partner_quantity: number;
}

type CollectorAuth = Parameters<typeof requireCollectorContext>[1];

export class DirectComparisonError extends Error {
  readonly status = 404;

  constructor() {
    super("Comparison unavailable.");
    this.name = "DirectComparisonError";
  }
}

function hashCredential(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function generateCode(): string {
  return Array.from(
    { length: comparisonCodeLength },
    () => comparisonCodeAlphabet[randomInt(comparisonCodeAlphabet.length)]!,
  ).join("");
}

function displayCode(code: string): string {
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

function grantStatus(row: Pick<GrantRow, "expires_at" | "revoked_at">, now: Date): ComparisonGrantStatus {
  if (row.revoked_at) return "revoked";
  if (row.expires_at <= now) return "expired";
  return "active";
}

function toGrantSummary(row: GrantRow, now: Date): ComparisonGrantSummary {
  return {
    id: row.id,
    status: grantStatus(row, now),
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export function normalizeComparisonCode(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (normalized.length !== comparisonCodeLength) return null;
  return [...normalized].every((character) => comparisonCodeAlphabet.includes(character))
    ? normalized
    : null;
}

export function isComparisonToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function credentialHashes(credential: ComparisonCredential): { tokenHash: string | null; codeHash: string | null } | null {
  const hasToken = credential.token !== undefined;
  const hasCode = credential.code !== undefined;
  if (hasToken === hasCode) return null;
  if (credential.token !== undefined) {
    return isComparisonToken(credential.token)
      ? { tokenHash: hashCredential(credential.token), codeHash: null }
      : null;
  }
  const code = normalizeComparisonCode(credential.code ?? "");
  return code ? { tokenHash: null, codeHash: hashCredential(code) } : null;
}

async function loadActiveGrant(
  credential: ComparisonCredential,
  now: Date,
  executor: QueryExecutor,
): Promise<ActiveGrantRow | null> {
  const hashes = credentialHashes(credential);
  if (!hashes) return null;
  const result = await query<ActiveGrantRow>(
    `SELECT c.id AS collection_id, c.collector_id AS owner_collector_id, c.album_id
       FROM collection_comparison_grants grant
       JOIN collections c ON c.id = grant.collection_id
      WHERE (($1::text IS NOT NULL AND grant.token_hash = $1)
          OR ($2::text IS NOT NULL AND grant.code_hash = $2))
        AND grant.revoked_at IS NULL
        AND grant.expires_at > $3
        AND c.status = 'active'`,
    [hashes.tokenHash, hashes.codeHash, now],
    executor,
  );
  return result.rows[0] ?? null;
}

async function insertComparisonGrant(
  collectorId: string,
  collectionId: string,
  token: string,
  code: string,
  expiresAt: Date,
  executor: QueryExecutor,
): Promise<GrantRow | null> {
  const result = await query<GrantRow>(
    `INSERT INTO collection_comparison_grants (collection_id, token_hash, code_hash, expires_at)
     SELECT c.id, $3, $4, $5
       FROM collections c
      WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'
     RETURNING id, expires_at, revoked_at, created_at`,
    [collectionId, collectorId, hashCredential(token), hashCredential(code), expiresAt],
    executor,
  );
  return result.rows[0] ?? null;
}

export async function createComparisonGrant(
  collectorId: string,
  collectionId: string,
  pool: Pool = getPool(),
  now = new Date(),
): Promise<{ grant: ComparisonGrantSummary; token: string; code: string }> {
  const expiresAt = new Date(now.getTime() + comparisonLifetimeMs);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateToken();
    const rawCode = generateCode();
    try {
      const row = await insertComparisonGrant(
        collectorId,
        collectionId,
        token,
        rawCode,
        expiresAt,
        pool,
      );
      if (!row) throw new DirectComparisonError();
      return { grant: toGrantSummary(row, now), token, code: displayCode(rawCode) };
    } catch (error) {
      if (error instanceof DatabaseError && error.code === "23505") continue;
      throw error;
    }
  }
  throw new DirectComparisonError();
}

export async function listComparisonGrants(
  collectorId: string,
  collectionId: string,
  executor: QueryExecutor = getPool(),
  now = new Date(),
): Promise<ComparisonGrantSummary[]> {
  const collection = await query(
    `SELECT 1 FROM collections
      WHERE id = $1 AND collector_id = $2 AND status = 'active'`,
    [collectionId, collectorId],
    executor,
  );
  if (collection.rowCount !== 1) throw new DirectComparisonError();
  const result = await query<GrantRow>(
    `SELECT grant.id, grant.expires_at, grant.revoked_at, grant.created_at
       FROM collection_comparison_grants grant
      WHERE grant.collection_id = $1
      ORDER BY grant.created_at DESC, grant.id`,
    [collectionId],
    executor,
  );
  return result.rows.map((row) => toGrantSummary(row, now));
}

export async function revokeComparisonGrant(
  collectorId: string,
  collectionId: string,
  grantId: string,
  executor: QueryExecutor = getPool(),
): Promise<boolean> {
  const result = await query(
    `UPDATE collection_comparison_grants grant
        SET revoked_at = now(), updated_at = now()
       FROM collections c
      WHERE grant.id = $1
        AND grant.collection_id = $2
        AND c.id = grant.collection_id
        AND c.collector_id = $3
        AND c.status = 'active'
        AND grant.revoked_at IS NULL`,
    [grantId, collectionId, collectorId],
    executor,
  );
  return result.rowCount === 1;
}

export async function prepareDirectComparison(
  viewerCollectorId: string,
  credential: ComparisonCredential,
  executor: QueryExecutor = getPool(),
  now = new Date(),
): Promise<ComparisonSetup | null> {
  const grant = await loadActiveGrant(credential, now, executor);
  if (!grant || grant.owner_collector_id === viewerCollectorId) return null;
  const result = await query<{
    id: string;
    album_title: string;
    revision_number: number;
  }>(
    `SELECT viewer.id, album.title AS album_title, revision.revision_number
       FROM collections viewer
       JOIN albums album ON album.id = viewer.album_id
       JOIN album_revisions revision ON revision.id = viewer.revision_id
      WHERE viewer.collector_id = $1
        AND viewer.album_id = $2
        AND viewer.status = 'active'
      ORDER BY viewer.created_at, viewer.id`,
    [viewerCollectorId, grant.album_id],
    executor,
  );
  if (result.rows.length === 0) return null;
  return {
    collections: result.rows.map((row) => ({
      id: row.id,
      albumTitle: row.album_title,
      revisionNumber: row.revision_number,
    })),
  };
}

async function calculateDirectComparisonInTransaction(
  client: PoolClient,
  viewerCollectorId: string,
  viewerCollectionId: string,
  credential: ComparisonCredential,
  now: Date,
): Promise<DirectComparisonResult | null> {
  const grant = await loadActiveGrant(credential, now, client);
  if (!grant || grant.owner_collector_id === viewerCollectorId) return null;

  const rows = await query<DirectMatchRow>(
    `SELECT viewer_sticker.code AS viewer_code,
            partner_sticker.code AS partner_code,
            viewer_sticker.label AS viewer_label,
            section.id AS section_id,
            section.code AS section_code,
            section.name AS section_name,
            COALESCE(viewer_holding.quantity, 0)::integer AS viewer_quantity,
            COALESCE(partner_holding.quantity, 0)::integer AS partner_quantity
       FROM collections viewer
       JOIN collections partner
         ON partner.id = $3
        AND partner.album_id = viewer.album_id
        AND partner.collector_id <> viewer.collector_id
        AND partner.status = 'active'
       JOIN album_revision_stickers viewer_sticker
         ON viewer_sticker.revision_id = viewer.revision_id
       JOIN album_revision_stickers partner_sticker
         ON partner_sticker.revision_id = partner.revision_id
        AND partner_sticker.sticker_id = viewer_sticker.sticker_id
       JOIN album_sections section ON section.id = viewer_sticker.section_id
       LEFT JOIN holdings viewer_holding
         ON viewer_holding.collection_id = viewer.id
        AND viewer_holding.sticker_id = viewer_sticker.sticker_id
       LEFT JOIN holdings partner_holding
         ON partner_holding.collection_id = partner.id
        AND partner_holding.sticker_id = partner_sticker.sticker_id
      WHERE viewer.id = $1
        AND viewer.collector_id = $2
        AND viewer.status = 'active'
        AND ((viewer_holding.sticker_id IS NULL AND partner_holding.quantity > 1)
          OR (viewer_holding.quantity > 1 AND partner_holding.sticker_id IS NULL))
      ORDER BY section.sort_order, viewer_sticker.sort_order, viewer_sticker.sticker_id`,
    [viewerCollectionId, viewerCollectorId, grant.collection_id],
    client,
  );

  const metadata = await query<{ partner_display_name: string; album_title: string }>(
    `SELECT profile.display_name AS partner_display_name, album.title AS album_title
       FROM collections viewer
       JOIN collections partner
         ON partner.id = $3
        AND partner.album_id = viewer.album_id
        AND partner.collector_id <> viewer.collector_id
        AND partner.status = 'active'
       JOIN collector_profiles profile ON profile.id = partner.collector_id
       JOIN albums album ON album.id = viewer.album_id
      WHERE viewer.id = $1 AND viewer.collector_id = $2 AND viewer.status = 'active'`,
    [viewerCollectionId, viewerCollectorId, grant.collection_id],
    client,
  );
  const meta = metadata.rows[0];
  if (!meta) return null;

  const offersToYou: TradeSticker[] = [];
  const needsFromYou: TradeSticker[] = [];
  for (const row of rows.rows) {
    const sticker = {
      code: row.viewer_code,
      partnerCode: row.partner_code,
      label: row.viewer_label,
      section: { id: row.section_id, code: row.section_code, name: row.section_name },
    };
    if (row.viewer_quantity === 0 && row.partner_quantity > 1) {
      offersToYou.push({ ...sticker, spareCount: row.partner_quantity - 1 });
    } else if (row.viewer_quantity > 1 && row.partner_quantity === 0) {
      needsFromYou.push({ ...sticker, spareCount: row.viewer_quantity - 1 });
    }
  }
  const offeredCount = offersToYou.length;
  const wantedCount = needsFromYou.length;
  return {
    albumTitle: meta.album_title,
    partnerDisplayName: meta.partner_display_name,
    kind: offeredCount > 0 && wantedCount > 0
      ? "two-way"
      : offeredCount > 0 || wantedCount > 0
        ? "one-way"
        : "none",
    offersToYou,
    needsFromYou,
    offeredCount,
    wantedCount,
  };
}

export async function calculateDirectComparison(
  viewerCollectorId: string,
  viewerCollectionId: string,
  credential: ComparisonCredential,
  pool: Pool = getPool(),
  now = new Date(),
): Promise<DirectComparisonResult | null> {
  return withTransaction(async (client) => {
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [], client);
    return calculateDirectComparisonInTransaction(
      client,
      viewerCollectorId,
      viewerCollectionId,
      credential,
      now,
    );
  }, pool);
}

export async function createOwnComparisonGrant(
  headers: Headers,
  collectionId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<{ grant: ComparisonGrantSummary; token: string; code: string }> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const created = await createComparisonGrant(identity.collector.id, collectionId, pool);
  writeAuditEvent(
    "comparison_grant.created",
    { type: "user", userId: identity.userId },
    { type: "comparison_grant", id: created.grant.id },
    { expiresAt: created.grant.expiresAt },
  );
  return created;
}

export async function getOwnComparisonGrants(
  headers: Headers,
  collectionId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<ComparisonGrantSummary[]> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return listComparisonGrants(identity.collector.id, collectionId, pool);
}

export async function revokeOwnComparisonGrant(
  headers: Headers,
  collectionId: string,
  grantId: string,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const revoked = await revokeComparisonGrant(identity.collector.id, collectionId, grantId, pool);
  if (revoked) {
    writeAuditEvent(
      "comparison_grant.revoked",
      { type: "user", userId: identity.userId },
      { type: "comparison_grant", id: grantId },
    );
  }
  return revoked;
}

export async function getOwnComparisonSetup(
  headers: Headers,
  credential: ComparisonCredential,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<ComparisonSetup> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const setup = await prepareDirectComparison(identity.collector.id, credential, pool);
  if (!setup) throw new DirectComparisonError();
  return setup;
}

export async function getOwnDirectComparison(
  headers: Headers,
  collectionId: string,
  credential: ComparisonCredential,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<DirectComparisonResult> {
  const identity = await requireCollectorContext(headers, auth, pool);
  const result = await calculateDirectComparison(
    identity.collector.id,
    collectionId,
    credential,
    pool,
  );
  if (!result) throw new DirectComparisonError();
  return result;
}
