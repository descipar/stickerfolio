import { Pool, type PoolConfig } from "pg";

import { getEnvironment, type AppEnvironment } from "@/infrastructure/config";

type DatabaseConfiguration = AppEnvironment["database"];

declare global {
  var __stickerfolioPgPool: Pool | undefined;
}

let runtimePool: Pool | undefined;

export function createPgClientConfig(database: DatabaseConfiguration): PoolConfig {
  const ssl =
    database.sslMode === "disable"
      ? undefined
      : {
          rejectUnauthorized: ["verify-ca", "verify-full"].includes(database.sslMode),
          ...(database.certificateAuthority ? { ca: database.certificateAuthority } : {}),
        };

  return {
    connectionString: database.url,
    max: database.poolMax,
    idleTimeoutMillis: database.idleTimeoutMs,
    connectionTimeoutMillis: database.connectionTimeoutMs,
    application_name: "stickerfolio",
    ...(ssl ? { ssl } : {}),
  };
}

export function createPool(environment: AppEnvironment = getEnvironment()): Pool {
  return new Pool(createPgClientConfig(environment.database));
}

export function getPool(environment: AppEnvironment = getEnvironment()): Pool {
  if (environment.nodeEnv === "development") {
    globalThis.__stickerfolioPgPool ??= createPool(environment);
    return globalThis.__stickerfolioPgPool;
  }

  runtimePool ??= createPool(environment);
  return runtimePool;
}

export async function closeDatabasePool(): Promise<void> {
  const pools = new Set([runtimePool, globalThis.__stickerfolioPgPool].filter(Boolean));
  await Promise.all([...pools].map((pool) => pool!.end()));
  runtimePool = undefined;
  globalThis.__stickerfolioPgPool = undefined;
}
