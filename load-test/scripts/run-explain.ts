/**
 * Runs EXPLAIN (ANALYZE, BUFFERS, VERBOSE) on the three latency-critical
 * Stickerfolio queries against DATABASE_URL and prints the plans (Roadmap
 * 12.2/12.3, issue #43). The SQL mirrors the repository/matching queries; it is
 * kept here (rather than importing private SQL) purely so the plans stay
 * copy-pasteable and reviewable alongside load-test/sql/explain-analyze.sql.
 *
 * Set EXPLAIN_OUT to also write the plans to a file:
 *   EXPLAIN_OUT=load-test/results/explain-analyze.txt pnpm exec tsx load-test/scripts/run-explain.ts
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { closeDatabasePool, getPool, query } from "@/infrastructure/database";

const ALBUM_VIEW = `
SELECT rs.sticker_id AS id, rs.code, rs.label, rs.section_id,
       s.code AS section_code, s.name AS section_name, rs.sort_order,
       COALESCE(h.quantity, 0)::integer AS quantity
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active'
 ORDER BY rs.sort_order`;

const MISSING = `
SELECT rs.code, rs.label, s.code AS section_code, s.name AS section_name
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active' AND h.sticker_id IS NULL
 ORDER BY s.sort_order, rs.sort_order, rs.code`;

const DUPLICATES = `
SELECT rs.code, rs.label, s.code AS section_code, s.name AS section_name,
       COALESCE(h.quantity, 0)::integer AS quantity
  FROM collections c
  JOIN album_revision_stickers rs ON rs.revision_id = c.revision_id
  JOIN album_sections s ON s.id = rs.section_id
  LEFT JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = rs.sticker_id
 WHERE c.id = $1 AND c.collector_id = $2 AND c.status = 'active' AND h.quantity > 1
 ORDER BY s.sort_order, rs.sort_order, rs.code`;

const TRADE_MATCHING = `
SELECT partner.collector_id AS partner_collector_id, profile.display_name,
       owner_sticker.sticker_id, owner_sticker.code AS owner_code,
       partner_sticker.code AS partner_code, owner_sticker.label AS owner_label,
       section.id AS section_id, section.code AS section_code, section.name AS section_name,
       COALESCE(owner_holding.quantity, 0)::integer AS owner_quantity,
       COALESCE(partner_holding.quantity, 0)::integer AS partner_quantity,
       owner_sticker.sort_order AS owner_sort_order
  FROM collections owner
  JOIN collections partner
    ON partner.album_id = owner.album_id AND partner.collector_id <> owner.collector_id
   AND partner.status = 'active'
  JOIN trading_preferences partner_preference
    ON partner_preference.collector_id = partner.collector_id AND partner_preference.visible
  JOIN collector_profiles profile ON profile.id = partner.collector_id
  JOIN album_revision_stickers owner_sticker ON owner_sticker.revision_id = owner.revision_id
  JOIN album_revision_stickers partner_sticker
    ON partner_sticker.revision_id = partner.revision_id
   AND partner_sticker.sticker_id = owner_sticker.sticker_id
  JOIN album_sections section ON section.id = owner_sticker.section_id
  LEFT JOIN holdings owner_holding
    ON owner_holding.collection_id = owner.id AND owner_holding.sticker_id = owner_sticker.sticker_id
  LEFT JOIN holdings partner_holding
    ON partner_holding.collection_id = partner.id AND partner_holding.sticker_id = partner_sticker.sticker_id
 WHERE owner.id = $1 AND owner.collector_id = $2 AND owner.status = 'active'
   AND (($3::uuid IS NULL) OR owner_sticker.section_id = $3)
   AND ((owner_holding.sticker_id IS NULL AND partner_holding.quantity > 1)
     OR (owner_holding.quantity > 1 AND partner_holding.sticker_id IS NULL))
 ORDER BY profile.display_name, partner.collector_id, owner_sticker.sort_order, owner_sticker.sticker_id`;

const cases: { name: string; sql: string; params: unknown[] }[] = [];

let outFile: string | undefined;

function emit(text: string): void {
  process.stdout.write(`${text}\n`);
  if (outFile) appendFileSync(outFile, `${text}\n`);
}

async function main(): Promise<void> {
  const pool = getPool();
  outFile = process.env.EXPLAIN_OUT ? path.resolve(process.cwd(), process.env.EXPLAIN_OUT) : undefined;
  if (outFile) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, "");
  }

  const target = await query<{ collection_id: string; collector_id: string; section_id: string | null }>(
    `SELECT c.id AS collection_id, c.collector_id,
            (SELECT rs.section_id FROM album_revision_stickers rs
              WHERE rs.revision_id = c.revision_id ORDER BY rs.sort_order LIMIT 1) AS section_id
       FROM collections c
       LEFT JOIN trading_preferences tp ON tp.collector_id = c.collector_id AND tp.visible
      WHERE c.status = 'active'
      ORDER BY tp.visible DESC NULLS LAST, c.created_at
      LIMIT 1`,
    [],
    pool,
  );
  const chosen = target.rows[0];
  if (!chosen) throw new Error("No active collection found. Seed the load dataset first.");

  cases.push(
    { name: "1) Album view (target p95 < 400 ms)", sql: ALBUM_VIEW, params: [chosen.collection_id, chosen.collector_id] },
    { name: "1b) Missing anti-join", sql: MISSING, params: [chosen.collection_id, chosen.collector_id] },
    { name: "2) Duplicates (quantity > 1)", sql: DUPLICATES, params: [chosen.collection_id, chosen.collector_id] },
    {
      name: "3) Trade matching (target p95 < 1 s)",
      sql: TRADE_MATCHING,
      params: [chosen.collection_id, chosen.collector_id, null],
    },
  );

  emit(`# EXPLAIN ANALYZE — Stickerfolio critical queries`);
  emit(`# Generated: ${new Date().toISOString()}`);
  emit(`# Collection: ${chosen.collection_id}  Collector: ${chosen.collector_id}`);
  const version = await query<{ version: string }>("SELECT version()", [], pool);
  emit(`# ${version.rows[0]?.version ?? "unknown PostgreSQL"}`);
  emit("");

  for (const testCase of cases) {
    emit(`==================================================================`);
    emit(testCase.name);
    emit(`==================================================================`);
    const plan = await query<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, VERBOSE) ${testCase.sql}`,
      testCase.params,
      pool,
    );
    for (const row of plan.rows) emit(row["QUERY PLAN"]);
    emit("");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : "EXPLAIN run failed.");
    process.exitCode = 1;
  })
  .finally(() => {
    void closeDatabasePool();
  });
