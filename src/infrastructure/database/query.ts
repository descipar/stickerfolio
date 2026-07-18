import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { toDatabaseError } from "./errors";
import { getPool } from "./pool";

export type QueryExecutor = Pick<Pool | PoolClient, "query">;

export async function query<Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
  executor: QueryExecutor = getPool(),
): Promise<QueryResult<Row>> {
  try {
    return await executor.query<Row>(text, [...values]);
  } catch (error) {
    throw toDatabaseError(error);
  }
}
