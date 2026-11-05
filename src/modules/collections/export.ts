import { query, type QueryExecutor } from "@/infrastructure/database";

/** The collections module's part of the portable account export (#125). */
export interface CollectionDataExport {
  id: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  album: { id: string; slug: string; title: string };
  revision: {
    id: string;
    number: number;
    label: string;
    status: "draft" | "published" | "archived";
  };
  shareLinks: Array<{
    id: string;
    scope: "missing" | "duplicates" | "both";
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  holdings: Array<{
    stickerId: string;
    stableKey: string;
    code: string;
    label: string;
    section: { id: string; code: string; name: string };
    quantity: number;
    updatedAt: string | null;
  }>;
}

interface HoldingRow {
  collection_id: string;
  collection_status: "active" | "archived";
  collection_created_at: Date;
  collection_updated_at: Date;
  album_id: string;
  album_slug: string;
  album_title: string;
  revision_id: string;
  revision_number: number;
  revision_label: string;
  revision_status: "draft" | "published" | "archived";
  sticker_id: string;
  stable_key: string;
  code: string;
  label: string;
  section_id: string;
  section_code: string;
  section_name: string;
  quantity: number;
  holding_updated_at: Date | null;
}

interface ShareRow {
  id: string;
  collection_id: string;
  scope: "missing" | "duplicates" | "both";
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** Every collection of a collector with all revision stickers, holdings, and share links. */
export async function exportCollectionsForCollector(
  collectorId: string,
  executor?: QueryExecutor,
): Promise<CollectionDataExport[]> {
  const holdings = await query<HoldingRow>(
    `SELECT c.id AS collection_id, c.status AS collection_status,
            c.created_at AS collection_created_at, c.updated_at AS collection_updated_at,
            a.id AS album_id, a.slug AS album_slug, a.title AS album_title,
            r.id AS revision_id, r.revision_number, r.label AS revision_label,
            r.status AS revision_status, rs.sticker_id, st.stable_key, rs.code, rs.label,
            sec.id AS section_id, sec.code AS section_code, sec.name AS section_name,
            COALESCE(h.quantity, 0)::integer AS quantity,
            h.updated_at AS holding_updated_at
       FROM collections c
       JOIN albums a ON a.id = c.album_id
       JOIN album_revisions r ON r.id = c.revision_id
       JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
       JOIN stickers st ON st.id = rs.sticker_id
       JOIN album_sections sec ON sec.id = rs.section_id
       LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
      WHERE c.collector_id = $1
      ORDER BY c.created_at, c.id, sec.sort_order, rs.sort_order, rs.code`,
    [collectorId],
    executor,
  );
  const shares = await query<ShareRow>(
    `SELECT sl.id, sl.collection_id, sl.scope, sl.expires_at, sl.revoked_at,
            sl.created_at, sl.updated_at
       FROM collection_share_links sl
       JOIN collections c ON c.id = sl.collection_id
      WHERE c.collector_id = $1
      ORDER BY sl.collection_id, sl.created_at, sl.id`,
    [collectorId],
    executor,
  );

  const collections = new Map<string, CollectionDataExport>();
  for (const holding of holdings.rows) {
    let collection = collections.get(holding.collection_id);
    if (!collection) {
      collection = {
        id: holding.collection_id,
        status: holding.collection_status,
        createdAt: holding.collection_created_at.toISOString(),
        updatedAt: holding.collection_updated_at.toISOString(),
        album: { id: holding.album_id, slug: holding.album_slug, title: holding.album_title },
        revision: {
          id: holding.revision_id,
          number: holding.revision_number,
          label: holding.revision_label,
          status: holding.revision_status,
        },
        shareLinks: [],
        holdings: [],
      };
      collections.set(holding.collection_id, collection);
    }
    collection.holdings.push({
      stickerId: holding.sticker_id,
      stableKey: holding.stable_key,
      code: holding.code,
      label: holding.label,
      section: { id: holding.section_id, code: holding.section_code, name: holding.section_name },
      quantity: holding.quantity,
      updatedAt: holding.holding_updated_at?.toISOString() ?? null,
    });
  }
  for (const share of shares.rows) {
    collections.get(share.collection_id)?.shareLinks.push({
      id: share.id,
      scope: share.scope,
      expiresAt: share.expires_at?.toISOString() ?? null,
      revokedAt: share.revoked_at?.toISOString() ?? null,
      createdAt: share.created_at.toISOString(),
      updatedAt: share.updated_at.toISOString(),
    });
  }
  return [...collections.values()];
}
