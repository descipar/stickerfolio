import type { Pool } from "pg";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";
import { requireCollectorContext } from "@/modules/collectors";

export type TradeDirection = "all" | "one-way" | "two-way";
export type TradeSort = "compatibility" | "offered" | "wanted" | "name";

export class TradingError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 = 400,
  ) {
    super(message);
    this.name = "TradingError";
  }
}

export interface TradeSection {
  id: string;
  code: string;
  name: string;
}

export interface TradeSticker {
  code: string;
  partnerCode: string;
  label: string;
  section: TradeSection;
  spareCount: number;
}

export interface TradeMatch {
  displayName: string;
  kind: "one-way" | "two-way";
  offersToYou: TradeSticker[];
  needsFromYou: TradeSticker[];
  offeredCount: number;
  wantedCount: number;
}

export interface TradeMatchOptions {
  direction?: TradeDirection;
  sectionId?: string;
  sort?: TradeSort;
  limit?: number;
  offset?: number;
}

export interface TradeMatchResult {
  collection: { id: string; albumTitle: string };
  enabled: boolean;
  sections: TradeSection[];
  matches: TradeMatch[];
  total: number;
  limit: number;
  offset: number;
}

interface PartnerSummaryRow {
  partner_collector_id: string;
  display_name: string;
  offered_count: number;
  wanted_count: number;
  total: number;
}

interface DetailRow {
  partner_collector_id: string;
  owner_code: string;
  partner_code: string;
  owner_label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  owner_quantity: number;
  partner_quantity: number;
}

// Display names are ordered with the ICU root collation so the result matches
// the previous `localeCompare(..., "en")` ordering regardless of the database's
// libc locale (musl-based images sort bytewise). PostgreSQL 16+ ships ICU.
const nameOrder = `display_name COLLATE "und-x-icu", partner_collector_id`;

// Whitelisted ORDER BY clauses; never interpolate caller input.
const sortClauses: Record<TradeSort, string> = {
  compatibility: `(offered_count > 0 AND wanted_count > 0) DESC,
                  LEAST(offered_count, wanted_count) DESC,
                  offered_count + wanted_count DESC, ${nameOrder}`,
  offered: `offered_count DESC, ${nameOrder}`,
  wanted: `wanted_count DESC, ${nameOrder}`,
  name: nameOrder,
};

// Stickers of the owner's revision that can take part in a trade: missing
// (no holding row) or held as a duplicate. Shared by both queries so summary
// counts and detail lines always agree.
const ownerCandidatesCte = `
  owner_collection AS (
    SELECT c.id, c.collector_id, c.album_id, c.revision_id
      FROM collections c
     WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'
  ),
  owner_candidates AS (
    SELECT owner_sticker.sticker_id,
           owner_sticker.code,
           owner_sticker.label,
           owner_sticker.section_id,
           owner_sticker.sort_order,
           COALESCE(owner_holding.quantity, 0)::integer AS quantity
      FROM owner_collection owner
      JOIN album_revision_stickers owner_sticker
        ON owner_sticker.revision_id = owner.revision_id
      LEFT JOIN holdings owner_holding
        ON owner_holding.collection_id = owner.id
       AND owner_holding.sticker_id = owner_sticker.sticker_id
     WHERE ($3::uuid IS NULL OR owner_sticker.section_id = $3)
       AND (owner_holding.sticker_id IS NULL OR owner_holding.quantity > 1)
  ),
  visible_partners AS (
    SELECT partner.id, partner.collector_id, partner.revision_id
      FROM owner_collection owner
      JOIN collections partner
        ON partner.album_id = owner.album_id
       AND partner.collector_id <> owner.collector_id
       AND partner.status = 'active'
      JOIN trading_preferences partner_preference
        ON partner_preference.collector_id = partner.collector_id
       AND partner_preference.visible
  )`;

// Joins a candidate sticker to each visible partner's revision via the stable
// sticker ID. Combined with `exchangeRelevant`, only pairs where one side is
// missing the sticker and the other holds a spare copy remain.
const exchangeJoin = `
      FROM visible_partners partner
      JOIN album_revision_stickers partner_sticker
        ON partner_sticker.revision_id = partner.revision_id
      JOIN owner_candidates candidate
        ON candidate.sticker_id = partner_sticker.sticker_id
      LEFT JOIN holdings partner_holding
        ON partner_holding.collection_id = partner.id
       AND partner_holding.sticker_id = partner_sticker.sticker_id`;

const exchangeRelevant = `
      ((candidate.quantity = 0 AND partner_holding.quantity > 1)
        OR (candidate.quantity > 1 AND partner_holding.sticker_id IS NULL))`;

// Per-partner counts without building partner × sticker pairs:
// - offered: the partner's spare copies of stickers the owner is missing,
//   found through holdings(sticker_id, quantity);
// - wanted: the owner's duplicate stickers that exist in the partner's
//   revision, minus those the partner already holds. Holdings always reference
//   a sticker of the collection's own revision, so the subtraction is exact.
function summarySql(sort: TradeSort): string {
  return `
    WITH ${ownerCandidatesCte},
    offer_counts AS (
      SELECT partner_holding.collection_id, count(*)::integer AS offered_count
        FROM owner_candidates candidate
        JOIN holdings partner_holding
          ON partner_holding.sticker_id = candidate.sticker_id
         AND partner_holding.quantity > 1
       WHERE candidate.quantity = 0
       GROUP BY partner_holding.collection_id
    ),
    wanted_per_revision AS (
      SELECT partner_sticker.revision_id, count(*)::integer AS available_count
        FROM owner_candidates candidate
        JOIN album_revision_stickers partner_sticker
          ON partner_sticker.sticker_id = candidate.sticker_id
       WHERE candidate.quantity > 1
       GROUP BY partner_sticker.revision_id
    ),
    wanted_already_held AS (
      SELECT partner_holding.collection_id, count(*)::integer AS held_count
        FROM owner_candidates candidate
        JOIN holdings partner_holding ON partner_holding.sticker_id = candidate.sticker_id
       WHERE candidate.quantity > 1
       GROUP BY partner_holding.collection_id
    ),
    partner_counts AS (
      SELECT partner.collector_id AS partner_collector_id,
             COALESCE(offers.offered_count, 0) AS offered_count,
             COALESCE(revision_wants.available_count, 0)
               - COALESCE(held.held_count, 0) AS wanted_count
        FROM visible_partners partner
        LEFT JOIN offer_counts offers ON offers.collection_id = partner.id
        LEFT JOIN wanted_per_revision revision_wants ON revision_wants.revision_id = partner.revision_id
        LEFT JOIN wanted_already_held held ON held.collection_id = partner.id
    ),
    filtered AS (
      SELECT counts.*, profile.display_name
        FROM partner_counts counts
        JOIN collector_profiles profile ON profile.id = counts.partner_collector_id
       WHERE (counts.offered_count > 0 OR counts.wanted_count > 0)
         AND ($4::text = 'all'
          OR ($4::text = 'two-way') = (counts.offered_count > 0 AND counts.wanted_count > 0))
    )
    SELECT partner_collector_id, display_name, offered_count, wanted_count,
           count(*) OVER ()::integer AS total
      FROM filtered
     ORDER BY ${sortClauses[sort]}
     LIMIT $5 OFFSET $6`;
}

// Sticker lines for the partners on the requested page only ($4).
const detailSql = `
  WITH ${ownerCandidatesCte}
  SELECT partner.collector_id AS partner_collector_id,
         candidate.code AS owner_code,
         partner_sticker.code AS partner_code,
         candidate.label AS owner_label,
         section.id AS section_id,
         section.code AS section_code,
         section.name AS section_name,
         candidate.quantity AS owner_quantity,
         COALESCE(partner_holding.quantity, 0)::integer AS partner_quantity
    ${exchangeJoin}
    JOIN album_sections section ON section.id = candidate.section_id
   WHERE partner.collector_id = ANY($4::uuid[])
     AND ${exchangeRelevant}
   ORDER BY partner.collector_id, candidate.sort_order, candidate.sticker_id`;

export async function calculateTradeMatches(
  collectorId: string,
  collectionId: string,
  options: TradeMatchOptions = {},
  executor?: QueryExecutor,
): Promise<TradeMatchResult> {
  const direction = options.direction ?? "all";
  const sort = options.sort ?? "compatibility";
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);
  const sectionId = options.sectionId ?? null;

  const owner = await query<{ album_title: string; visible: boolean }>(
    `SELECT a.title AS album_title, COALESCE(tp.visible, false) AS visible
       FROM collections c
       JOIN albums a ON a.id = c.album_id
       LEFT JOIN trading_preferences tp ON tp.collector_id = c.collector_id
      WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'`,
    [collectionId, collectorId],
    executor,
  );
  const ownerCollection = owner.rows[0];
  if (!ownerCollection) throw new TradingError("Collection not found.", 404);

  const sectionsResult = await query<TradeSection>(
    `SELECT s.id, s.code, s.name
       FROM collections c
       JOIN album_sections s ON s.revision_id = c.revision_id
      WHERE c.id = $1 AND c.collector_id = $2
      ORDER BY s.sort_order, s.code`,
    [collectionId, collectorId],
    executor,
  );
  const baseResult = {
    collection: { id: collectionId, albumTitle: ownerCollection.album_title },
    enabled: ownerCollection.visible,
    sections: sectionsResult.rows,
    limit,
    offset,
  };
  if (!ownerCollection.visible) return { ...baseResult, matches: [], total: 0 };

  const summaryParams = [collectionId, collectorId, sectionId, direction];
  const summary = await query<PartnerSummaryRow>(
    summarySql(sort),
    [...summaryParams, limit, offset],
    executor,
  );
  let total = summary.rows[0]?.total ?? 0;
  if (summary.rows.length === 0 && offset > 0) {
    // A page past the end carries no window count; fetch the total cheaply.
    const count = await query<PartnerSummaryRow>(summarySql("name"), [...summaryParams, 1, 0], executor);
    total = count.rows[0]?.total ?? 0;
  }
  if (summary.rows.length === 0) return { ...baseResult, matches: [], total };

  const partnerIds = summary.rows.map((row) => row.partner_collector_id);
  const details = await query<DetailRow>(
    detailSql,
    [collectionId, collectorId, sectionId, partnerIds],
    executor,
  );
  const stickersByPartner = new Map<string, Pick<TradeMatch, "offersToYou" | "needsFromYou">>(
    partnerIds.map((id) => [id, { offersToYou: [], needsFromYou: [] }]),
  );
  for (const row of details.rows) {
    const group = stickersByPartner.get(row.partner_collector_id);
    if (!group) continue;
    const common = {
      code: row.owner_code,
      partnerCode: row.partner_code,
      label: row.owner_label,
      section: { id: row.section_id, code: row.section_code, name: row.section_name },
    };
    if (row.owner_quantity === 0) {
      group.offersToYou.push({ ...common, spareCount: row.partner_quantity - 1 });
    } else {
      group.needsFromYou.push({ ...common, spareCount: row.owner_quantity - 1 });
    }
  }

  return {
    ...baseResult,
    matches: summary.rows.map((row): TradeMatch => {
      const stickers = stickersByPartner.get(row.partner_collector_id)!;
      return {
        displayName: row.display_name,
        kind: row.offered_count > 0 && row.wanted_count > 0 ? "two-way" : "one-way",
        offersToYou: stickers.offersToYou,
        needsFromYou: stickers.needsFromYou,
        offeredCount: row.offered_count,
        wantedCount: row.wanted_count,
      };
    }),
    total,
  };
}

type CollectorAuth = Parameters<typeof requireCollectorContext>[1];

export async function getOwnTradeMatches(
  headers: Headers,
  collectionId: string,
  options: TradeMatchOptions = {},
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<TradeMatchResult> {
  const identity = await requireCollectorContext(headers, auth, pool);
  // Summary counts and page details are separate statements; one read-only
  // snapshot keeps them consistent under concurrent holding updates.
  return withTransaction(async (client) => {
    await query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", [], client);
    return calculateTradeMatches(identity.collector.id, collectionId, options, client);
  }, pool);
}
