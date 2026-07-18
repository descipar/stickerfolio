import type { Pool, PoolClient } from "pg";

import { toDatabaseError } from "./errors";
import { getPool } from "./pool";

export async function withTransaction<Result>(
  operation: (client: PoolClient) => Promise<Result>,
  pool: Pool = getPool(),
): Promise<Result> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw toDatabaseError(error);
  }

  try {
    try {
      await client.query("BEGIN");
    } catch (error) {
      throw toDatabaseError(error);
    }

    let result: Result;
    try {
      result = await operation(client);
    } catch (operationError) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw toDatabaseError(rollbackError);
      }
      throw operationError;
    }

    try {
      await client.query("COMMIT");
    } catch (commitError) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw toDatabaseError(rollbackError);
      }
      throw toDatabaseError(commitError);
    }

    return result;
  } finally {
    client.release();
  }
}
