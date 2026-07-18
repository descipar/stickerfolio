import packageMetadata from "../../../package.json";

import { query, type QueryExecutor } from "@/infrastructure/database";

export const appVersion = packageMetadata.version;

export interface VersionInformation {
  app: string;
  schema: string | null;
}

export async function getVersionInformation(executor?: QueryExecutor): Promise<VersionInformation> {
  const result = await query<{ name: string }>(
    "SELECT name FROM schema_migrations ORDER BY run_on DESC, name DESC LIMIT 1",
    [],
    executor,
  );

  return { app: appVersion, schema: result.rows[0]?.name ?? null };
}
