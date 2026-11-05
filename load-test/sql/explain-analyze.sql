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

-- 3) TRADE MATCHING (target p95 < 1 s) is no longer a single statement. Since
--    #117 the trading module aggregates, filters, sorts, and paginates partner
--    summaries in PostgreSQL and then loads sticker lines for the requested page
--    only. To avoid a drifting copy of that SQL, explain the statements the
--    application really executes with:
--
--      DATABASE_URL=... pnpm loadtest:explain
--
--    load-test/results/trade-matching.md compares it with the previous query.
