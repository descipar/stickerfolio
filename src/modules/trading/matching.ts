import type { Pool } from "pg";

import { getPool, query, type QueryExecutor } from "@/infrastructure/database";
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

interface MatchRow {
  partner_collector_id: string;
  display_name: string;
  sticker_id: string;
  owner_code: string;
  partner_code: string;
  owner_label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  owner_quantity: number;
  partner_quantity: number;
  owner_sort_order: number;
}

interface InternalMatch extends TradeMatch {
  partnerCollectorId: string;
}

function sortMatches(matches: InternalMatch[], sort: TradeSort): void {
  matches.sort((left, right) => {
    if (sort === "compatibility") {
      const kind = Number(right.kind === "two-way") - Number(left.kind === "two-way");
      if (kind !== 0) return kind;
      const balanced = Math.min(right.offeredCount, right.wantedCount)
        - Math.min(left.offeredCount, left.wantedCount);
      if (balanced !== 0) return balanced;
      const total = right.offeredCount + right.wantedCount - left.offeredCount - left.wantedCount;
      if (total !== 0) return total;
    } else if (sort === "offered") {
      const offered = right.offeredCount - left.offeredCount;
      if (offered !== 0) return offered;
    } else if (sort === "wanted") {
      const wanted = right.wantedCount - left.wantedCount;
      if (wanted !== 0) return wanted;
    }
    const name = left.displayName.localeCompare(right.displayName, "en");
    return name || left.partnerCollectorId.localeCompare(right.partnerCollectorId);
  });
}

function toPublicMatch(match: InternalMatch): TradeMatch {
  return {
    displayName: match.displayName,
    kind: match.kind,
    offersToYou: match.offersToYou,
    needsFromYou: match.needsFromYou,
    offeredCount: match.offeredCount,
    wantedCount: match.wantedCount,
  };
}

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

  const rows = await query<MatchRow>(
    `SELECT partner.collector_id AS partner_collector_id,
            profile.display_name,
            owner_sticker.sticker_id,
            owner_sticker.code AS owner_code,
            partner_sticker.code AS partner_code,
            owner_sticker.label AS owner_label,
            section.id AS section_id,
            section.code AS section_code,
            section.name AS section_name,
            COALESCE(owner_holding.quantity, 0)::integer AS owner_quantity,
            COALESCE(partner_holding.quantity, 0)::integer AS partner_quantity,
            owner_sticker.sort_order AS owner_sort_order
       FROM collections owner
       JOIN collections partner
         ON partner.album_id = owner.album_id
        AND partner.collector_id <> owner.collector_id
        AND partner.status = 'active'
       JOIN trading_preferences partner_preference
         ON partner_preference.collector_id = partner.collector_id
        AND partner_preference.visible
       JOIN collector_profiles profile ON profile.id = partner.collector_id
       JOIN album_revision_stickers owner_sticker
         ON owner_sticker.revision_id = owner.revision_id
       JOIN album_revision_stickers partner_sticker
         ON partner_sticker.revision_id = partner.revision_id
        AND partner_sticker.sticker_id = owner_sticker.sticker_id
       JOIN album_sections section ON section.id = owner_sticker.section_id
       LEFT JOIN holdings owner_holding
         ON owner_holding.collection_id = owner.id
        AND owner_holding.sticker_id = owner_sticker.sticker_id
       LEFT JOIN holdings partner_holding
         ON partner_holding.collection_id = partner.id
        AND partner_holding.sticker_id = partner_sticker.sticker_id
      WHERE owner.id = $1
        AND owner.collector_id = $2
        AND owner.status = 'active'
        AND ($3::uuid IS NULL OR owner_sticker.section_id = $3)
        AND ((owner_holding.sticker_id IS NULL AND partner_holding.quantity > 1)
          OR (owner_holding.quantity > 1 AND partner_holding.sticker_id IS NULL))
      ORDER BY profile.display_name, partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id`,
    [collectionId, collectorId, options.sectionId ?? null],
    executor,
  );

  const grouped = new Map<string, InternalMatch>();
  for (const row of rows.rows) {
    const match = grouped.get(row.partner_collector_id) ?? {
      partnerCollectorId: row.partner_collector_id,
      displayName: row.display_name,
      kind: "one-way" as const,
      offersToYou: [],
      needsFromYou: [],
      offeredCount: 0,
      wantedCount: 0,
    };
    const common = {
      code: row.owner_code,
      partnerCode: row.partner_code,
      label: row.owner_label,
      section: { id: row.section_id, code: row.section_code, name: row.section_name },
    };
    if (row.owner_quantity === 0 && row.partner_quantity > 1) {
      match.offersToYou.push({ ...common, spareCount: row.partner_quantity - 1 });
    } else if (row.owner_quantity > 1 && row.partner_quantity === 0) {
      match.needsFromYou.push({ ...common, spareCount: row.owner_quantity - 1 });
    }
    match.offeredCount = match.offersToYou.length;
    match.wantedCount = match.needsFromYou.length;
    match.kind = match.offeredCount > 0 && match.wantedCount > 0 ? "two-way" : "one-way";
    grouped.set(row.partner_collector_id, match);
  }

  const matches = [...grouped.values()].filter((match) =>
    direction === "all" || match.kind === direction,
  );
  sortMatches(matches, sort);
  const total = matches.length;
  return {
    ...baseResult,
    matches: matches.slice(offset, offset + limit).map(toPublicMatch),
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
  return calculateTradeMatches(identity.collector.id, collectionId, options, pool);
}
