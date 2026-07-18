import path from "node:path";

import { runner, type RunnerOption } from "node-pg-migrate";

import type { AppEnvironment } from "@/infrastructure/config";

import { createPgClientConfig } from "./pool";

export type MigrationDirection = "up" | "down";

const migrationsDirectory = path.resolve(process.cwd(), "migrations");

export async function runMigrations(
  environment: AppEnvironment,
  direction: MigrationDirection = "up",
): Promise<Awaited<ReturnType<typeof runner>>> {
  const options: RunnerOption = {
    databaseUrl: createPgClientConfig(environment.database),
    dir: migrationsDirectory,
    direction,
    count: direction === "down" ? 1 : undefined,
    migrationsTable: "schema_migrations",
    checkOrder: true,
    singleTransaction: true,
    advisoryLockMode: "fail",
    noLock: false,
    verbose: false,
    tsconfigPaths: true,
  };

  return runner(options);
}
