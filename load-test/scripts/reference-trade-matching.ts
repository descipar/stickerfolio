import { query, type QueryExecutor } from "@/infrastructure/database";
import type { TradeMatch, TradeMatchOptions } from "@/modules/trading";

/**
 * Reference oracle for trade matching: the pre-#117 implementation, which
 * loads every exchange-relevant sticker row for every visible partner and then
 * groups, filters, sorts, and paginates in Node.js. It is deliberately simple
 * and is used by the equivalence integration test and the benchmark to prove
 * the SQL-side implementation is equivalent.
 */
interface ReferenceRow {
  partner_collector_id: string;
  display_name: string;
  owner_code: string;
  partner_code: string;
  owner_label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  owner_quantity: number;
  partner_quantity: number;
}

interface ReferenceMatch extends TradeMatch {
  partnerCollectorId: string;
}

export async function referenceTradeMatches(
  collectorId: string,
  collectionId: string,
  options: TradeMatchOptions,
  pool: QueryExecutor,
): Promise<{ total: number; matches: TradeMatch[] }> {
  const direction = options.direction ?? "all";
  const sort = options.sort ?? "compatibility";
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);

  const rows = await query<ReferenceRow>(
    `SELECT partner.collector_id AS partner_collector_id,
            profile.display_name,
            owner_sticker.code AS owner_code,
            partner_sticker.code AS partner_code,
            owner_sticker.label AS owner_label,
            section.id AS section_id,
            section.code AS section_code,
            section.name AS section_name,
            COALESCE(owner_holding.quantity, 0)::integer AS owner_quantity,
            COALESCE(partner_holding.quantity, 0)::integer AS partner_quantity
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
    pool,
  );

  const grouped = new Map<string, ReferenceMatch>();
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

  const matches = [...grouped.values()].filter((match) => direction === "all" || match.kind === direction);
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

  return {
    total: matches.length,
    matches: matches.slice(offset, offset + limit).map((match) => {
      const { partnerCollectorId, ...publicMatch } = match;
      void partnerCollectorId;
      return publicMatch;
    }),
  };
}
