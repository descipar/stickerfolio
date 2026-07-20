import type { Pool } from "pg";

import { getPool, query, type QueryExecutor } from "@/infrastructure/database";
import { requireCollectorContext } from "@/modules/collectors";

export async function getTradingVisibility(
  collectorId: string,
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query<{ visible: boolean }>(
    "SELECT visible FROM trading_preferences WHERE collector_id = $1",
    [collectorId],
    executor,
  );
  return result.rows[0]?.visible ?? false;
}

export async function setTradingVisibility(
  collectorId: string,
  visible: boolean,
  executor?: QueryExecutor,
): Promise<void> {
  await query(
    `INSERT INTO trading_preferences (collector_id, visible, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (collector_id)
     DO UPDATE SET visible = EXCLUDED.visible, updated_at = now()`,
    [collectorId, visible],
    executor,
  );
}

type CollectorAuth = Parameters<typeof requireCollectorContext>[1];

export async function getOwnTradingVisibility(
  headers: Headers,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = await requireCollectorContext(headers, auth, pool);
  return getTradingVisibility(identity.collector.id, pool);
}

export async function setOwnTradingVisibility(
  headers: Headers,
  visible: boolean,
  auth?: CollectorAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const identity = await requireCollectorContext(headers, auth, pool);
  await setTradingVisibility(identity.collector.id, visible, pool);
}
