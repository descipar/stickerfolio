import { expectedMigrations, query, type QueryExecutor } from "@/infrastructure/database";

import { appVersion } from "./version";

export interface LivenessStatus {
  status: "ok";
  appVersion: string;
}

/**
 * - `current`: the database has exactly the migrations this build expects.
 * - `ahead`: every expected migration is applied, plus newer ones this build
 *   does not know. This is the rollback case (previous image on a newer,
 *   forward-compatible schema) and stays ready.
 * - `behind`: at least one expected migration is missing. Not ready.
 */
export type SchemaState = "current" | "ahead" | "behind";

export interface ReadinessStatus {
  status: "ready" | "not_ready";
  app: string;
  schema: string | null;
  expectedSchema: string;
  schemaState: SchemaState;
}

export function getLivenessStatus(): LivenessStatus {
  return { status: "ok", appVersion };
}

export function classifySchema(
  applied: readonly string[],
  expected: readonly string[] = expectedMigrations,
): SchemaState {
  const appliedSet = new Set(applied);
  if (expected.some((name) => !appliedSet.has(name))) return "behind";
  const expectedSet = new Set(expected);
  return applied.some((name) => !expectedSet.has(name)) ? "ahead" : "current";
}

export async function getReadinessStatus(executor?: QueryExecutor): Promise<ReadinessStatus> {
  const result = await query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY run_on DESC, name DESC",
    [],
    executor,
  );
  const applied = result.rows.map((row) => row.name);
  const schemaState = classifySchema(applied);

  return {
    status: schemaState === "behind" ? "not_ready" : "ready",
    app: appVersion,
    schema: applied[0] ?? null,
    expectedSchema: expectedMigrations[expectedMigrations.length - 1],
    schemaState,
  };
}
