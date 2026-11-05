import type { Pool } from "pg";

import { getPool, query, type QueryExecutor } from "@/infrastructure/database";
import { type Principal, requireCollectorPrincipal } from "@/shared/principal";

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


export async function getOwnTradingVisibility(
  principal: Principal | null,
  pool: Pool = getPool(),
): Promise<boolean> {
  const identity = requireCollectorPrincipal(principal);
  return getTradingVisibility(identity.collectorId, pool);
}

export async function setOwnTradingVisibility(
  principal: Principal | null,
  visible: boolean,
  pool: Pool = getPool(),
): Promise<void> {
  const identity = requireCollectorPrincipal(principal);
  await setTradingVisibility(identity.collectorId, visible, pool);
}
