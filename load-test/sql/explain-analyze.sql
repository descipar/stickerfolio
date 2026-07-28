-- EXPLAIN ANALYZE of the critical Stickerfolio queries (Roadmap 12.2/12.3, #43).
--
-- These mirror the queries the app runs for the three latency-critical
-- operations. Run them against a SEEDED database (see load-test/README.md) with
-- psql, after setting the two ids to a real, trading-visible collection:
--
--   \set collection_id '00000000-0000-0000-0000-000000000000'
--   \set collector_id  '00000000-0000-0000-0000-000000000000'
--   \i load-test/sql/explain-analyze.sql
--
-- A convenient way to obtain a visible collection id:
--   SELECT c.id AS collection_id, c.collector_id
--     FROM collections c
--     JOIN trading_preferences tp ON tp.collector_id = c.collector_id AND tp.visible
--    WHERE c.status = 'active' LIMIT 1;
--
-- load-test/scripts/run-explain.ts runs exactly these against DATABASE_URL and
-- captures the plans into load-test/results/explain-analyze.txt.

-- 1) ALBUM VIEW (target p95 < 400 ms) — full per-sticker list with owned quantity.
--    LEFT JOIN holdings is the anti-join that yields "missing" stickers
--    (quantity 0 => no holdings row). Index of interest:
--    album_revision_stickers PK (revision_id, sticker_id) + holdings PK
--    (collection_id, sticker_id).
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT rs.sticker_id AS id, rs.code, rs.label, rs.section_id,
       s.code AS section_code, s.name AS section_name, rs.sort_order,
       COALESCE(h.quantity, 0)::integer AS quantity
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = :'collection_id' AND c.collector_id = :'collector_id' AND c.status = 'active'
 ORDER BY rs.sort_order;

-- 1b) MISSING anti-join in isolation (the "missing stickers" export/derivation).
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT rs.code, rs.label, s.code AS section_code, s.name AS section_name
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = :'collection_id' AND c.collector_id = :'collector_id'
   AND c.status = 'active' AND h.sticker_id IS NULL
 ORDER BY s.sort_order, rs.sort_order, rs.code;

-- 2) DUPLICATES (quantity > 1). Roadmap 12.2 calls for a narrow partial index
--    for quantity > 1; the shipped schema currently has the composite index
--    holdings_sticker_quantity_idx (sticker_id, quantity). This plan documents
--    what the planner actually uses so the index decision follows real data.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT rs.code, rs.label, s.code AS section_code, s.name AS section_name,
       COALESCE(h.quantity, 0)::integer AS quantity
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = :'collection_id' AND c.collector_id = :'collector_id'
   AND c.status = 'active' AND h.quantity > 1
 ORDER BY s.sort_order, rs.sort_order, rs.code;

-- 3) TRADE MATCHING (target p95 < 1 s). Owner collection vs. every other active,
--    trading-visible collection for the same album; keeps rows where one side is
--    missing a sticker the other holds as a duplicate. Indexes of interest:
--    collections_trade_candidates_idx (album_id, collector_id, revision_id) WHERE
--    status='active', trading_preferences_visible_idx, holdings PK.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT partner.collector_id AS partner_collector_id,
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
 WHERE owner.id = :'collection_id'
   AND owner.collector_id = :'collector_id'
   AND owner.status = 'active'
   AND ((owner_holding.sticker_id IS NULL AND partner_holding.quantity > 1)
     OR (owner_holding.quantity > 1 AND partner_holding.sticker_id IS NULL))
 ORDER BY profile.display_name, partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id;
