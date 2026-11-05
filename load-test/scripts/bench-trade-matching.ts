/**
 * Trade-matching benchmark for issue #117.
 *
 * Compares the previous implementation (every exchange-relevant sticker row
 * for every visible partner loaded into Node.js, then grouped, sorted, and
 * paginated there) with the current SQL-side aggregation, at several numbers
 * of collectors sharing one album. Records rows transferred, median latency,
 * and EXPLAIN (ANALYZE, BUFFERS) plans.
 *
 * Use a DISPOSABLE database that is migrated and has the World Cup 2026
 * catalog seeded. The script deletes and recreates its own "Bench …" accounts
 * and collector profiles (no passwords; they cannot sign in):
 *
 *   pnpm db:migrate && pnpm seed:wm2026
 *   BENCH_SIZES=50,500,2000 BENCH_OUT=load-test/results/trade-matching.md \
 *     pnpm exec tsx load-test/scripts/bench-trade-matching.ts
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import type { QueryResultRow } from "pg";

import { closeDatabasePool, getPool, query, type QueryExecutor } from "@/infrastructure/database";
import { calculateTradeMatches } from "@/modules/trading";

import { referenceTradeMatches } from "./reference-trade-matching";

const sizes = (process.env.BENCH_SIZES ?? "50,500,2000").split(",").map(Number);
const runs = Number(process.env.BENCH_RUNS ?? 7);
const outFile = process.env.BENCH_OUT;
const pageSize = 20;

interface Recorded { rows: number }

function recordingExecutor(target: QueryExecutor, recorded: Recorded): QueryExecutor {
  return {
    query: (async (text: string, values?: unknown[]) => {
      const result = await target.query(text, values);
      recorded.rows += result.rowCount ?? 0;
      return result;
    }) as QueryExecutor["query"],
  };
}

function explainingExecutor(target: QueryExecutor, plans: string[], match: (sql: string) => boolean): QueryExecutor {
  return {
    query: (async (text: string, values?: unknown[]) => {
      if (match(text)) {
        const plan = await target.query<QueryResultRow>(`EXPLAIN (ANALYZE, BUFFERS) ${text}`, values);
        plans.push(plan.rows.map((row) => row["QUERY PLAN"]).join("\n"));
      }
      return target.query(text, values);
    }) as QueryExecutor["query"],
  };
}

async function measure(run: (executor: QueryExecutor) => Promise<unknown>): Promise<{ ms: number; rows: number }> {
  const pool = getPool();
  for (let warmup = 0; warmup < 2; warmup += 1) await run(pool);
  const timings: number[] = [];
  let rows = 0;
  for (let index = 0; index < runs; index += 1) {
    const recorded = { rows: 0 };
    const started = performance.now();
    await run(recordingExecutor(pool, recorded));
    timings.push(performance.now() - started);
    rows = recorded.rows;
  }
  timings.sort((left, right) => left - right);
  return { ms: timings[Math.floor(timings.length / 2)]!, rows };
}

async function growTo(target: number, current: number, album: { album_id: string; revision_id: string }) {
  if (target <= current) return;
  await query(`SELECT setseed($1)`, [current / (target + 1)]);
  await query(
    `WITH new_accounts AS (
       INSERT INTO "user" (name, email)
       SELECT 'Bench ' || g, 'bench-' || g || '@bench.test' FROM generate_series($1::int, $2::int) g
       RETURNING id, name
     ), new_profiles AS (
       INSERT INTO collector_profiles (display_name, onboarding_completed_at, user_id)
       SELECT name, now(), id FROM new_accounts
       RETURNING id
     ), new_collections AS (
       INSERT INTO collections (collector_id, album_id, revision_id)
       SELECT id, $3, $4 FROM new_profiles
       RETURNING id, album_id, revision_id
     ), draws AS (
       SELECT nc.id AS collection_id, nc.album_id, nc.revision_id, rs.sticker_id,
              random() AS owned, random() AS duplicate, random() AS extra
         FROM new_collections nc
         JOIN album_revision_stickers rs ON rs.revision_id = nc.revision_id
     )
     INSERT INTO holdings (collection_id, album_id, revision_id, sticker_id, quantity)
     SELECT collection_id, album_id, revision_id, sticker_id,
            CASE WHEN duplicate < 0.22 THEN 2 + floor(extra * 2)::int ELSE 1 END
       FROM draws
      WHERE owned < 0.65`,
    [current + 1, target, album.album_id, album.revision_id],
  );
  await query(
    `UPDATE trading_preferences tp SET visible = random() < 0.9
       FROM collector_profiles cp
      WHERE cp.id = tp.collector_id AND cp.display_name LIKE 'Bench %'
        AND cp.display_name <> 'Bench 1'`,
  );
  await query(`ANALYZE`);
}

async function main(): Promise<void> {
  const album = (await query<{ album_id: string; revision_id: string }>(
    `SELECT a.id AS album_id, r.id AS revision_id
       FROM albums a JOIN album_revisions r ON r.album_id = a.id AND r.status = 'published'
      WHERE a.title = 'Panini FIFA World Cup 2026'`,
  )).rows[0];
  if (!album) throw new Error("Seed the World Cup 2026 catalog first (pnpm seed:wm2026).");

  await query(`DELETE FROM "user" WHERE email LIKE 'bench-%@bench.test'`);
  const version = (await query<{ version: string }>(`SHOW server_version`)).rows[0]!.version;
  const lines: string[] = [
    "# Trade matching benchmark (#117)",
    "",
    `Generated ${new Date().toISOString()} on PostgreSQL ${version}. Album: Panini FIFA World Cup 2026 (994 stickers).`,
    "Each collector owns ~65 % of stickers, ~22 % of owned stickers are duplicates, ~90 % opted into trading.",
    `Request: first page of ${pageSize} partners, compatibility sort. Median of ${runs} runs after 2 warm-ups;`,
    "latency includes the Node.js work of the respective implementation.",
    "",
    "| Collectors | Visible partners | Previous: rows to Node.js | Previous: median ms | Current: rows to Node.js | Current: median ms |",
    "|---:|---:|---:|---:|---:|---:|",
  ];
  const plans: string[] = [];

  let current = 0;
  for (const size of sizes) {
    await growTo(size, current, album);
    current = size;
    const owner = (await query<{ collector_id: string; collection_id: string }>(
      `SELECT cp.id AS collector_id, c.id AS collection_id
         FROM collector_profiles cp JOIN collections c ON c.collector_id = cp.id
        WHERE cp.display_name = 'Bench 1'`,
    )).rows[0]!;
    await query(`UPDATE trading_preferences SET visible = true WHERE collector_id = $1`, [owner.collector_id]);
    const options = { sort: "compatibility" as const, limit: pageSize, offset: 0 };

    const previous = await measure((executor) =>
      referenceTradeMatches(owner.collector_id, owner.collection_id, options, executor));
    const current_ = await measure((executor) =>
      calculateTradeMatches(owner.collector_id, owner.collection_id, options, executor));
    const result = await calculateTradeMatches(owner.collector_id, owner.collection_id, options);
    lines.push(`| ${size} | ${result.total} | ${previous.rows} | ${previous.ms.toFixed(1)} | ${current_.rows} | ${current_.ms.toFixed(1)} |`);
    console.info(lines.at(-1));

    if (size === sizes[0] || size === sizes.at(-1)) {
      const recorded: string[] = [];
      await calculateTradeMatches(owner.collector_id, owner.collection_id, options,
        explainingExecutor(getPool(), recorded, (sql) => sql.includes("visible_partners")));
      plans.push(`## Current summary query (${size} collectors)\n\n\`\`\`text\n${recorded[0]}\n\`\`\``);
      plans.push(`## Current detail query for one page (${size} collectors)\n\n\`\`\`text\n${recorded[1]}\n\`\`\``);
      const legacy: string[] = [];
      await referenceTradeMatches(owner.collector_id, owner.collection_id, options,
        explainingExecutor(getPool(), legacy, () => true));
      plans.push(`## Previous query (${size} collectors)\n\n\`\`\`text\n${legacy[0]}\n\`\`\``);
    }
  }

  const notes = process.env.BENCH_NOTES ? ["", process.env.BENCH_NOTES] : [];
  const output = [...lines, ...notes, "", ...plans, ""].join("\n");
  if (outFile) writeFileSync(outFile, output);
  else console.info(output);
  await query(`DELETE FROM "user" WHERE email LIKE 'bench-%@bench.test'`);
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    console.error(error);
    await closeDatabasePool();
    process.exitCode = 1;
  });
