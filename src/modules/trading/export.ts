import { query, type QueryExecutor } from "@/infrastructure/database";

/** The trading module's part of the portable account export (#125). */
export interface TradingDataExport {
  preferences: { visible: boolean; updatedAt: string | null };
  comparisonGrants: Array<{
    id: string;
    collectionId: string;
    expiresAt: string;
    revokedAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export async function exportTradingDataForCollector(
  collectorId: string,
  executor?: QueryExecutor,
): Promise<TradingDataExport> {
  const preferences = await query<{ visible: boolean; updated_at: Date }>(
    "SELECT visible, updated_at FROM trading_preferences WHERE collector_id = $1",
    [collectorId],
    executor,
  );
  const grants = await query<{
    id: string;
    collection_id: string;
    expires_at: Date;
    revoked_at: Date | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT cg.id, cg.collection_id, cg.expires_at, cg.revoked_at, cg.created_at, cg.updated_at
       FROM collection_comparison_grants cg
       JOIN collections c ON c.id = cg.collection_id
      WHERE c.collector_id = $1
      ORDER BY cg.collection_id, cg.created_at, cg.id`,
    [collectorId],
    executor,
  );
  const preference = preferences.rows[0];
  return {
    preferences: {
      visible: preference?.visible ?? false,
      updatedAt: preference?.updated_at.toISOString() ?? null,
    },
    comparisonGrants: grants.rows.map((grant) => ({
      id: grant.id,
      collectionId: grant.collection_id,
      expiresAt: grant.expires_at.toISOString(),
      revokedAt: grant.revoked_at?.toISOString() ?? null,
      createdAt: grant.created_at.toISOString(),
      updatedAt: grant.updated_at.toISOString(),
    })),
  };
}
