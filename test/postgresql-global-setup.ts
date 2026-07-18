import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

import { runMigrations } from "@/infrastructure/database";

import { createTestEnvironment } from "./create-test-environment";

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("stickerfolio_test")
    .withUsername("stickerfolio")
    .withPassword("stickerfolio")
    .start();

  const databaseUrl = container.getConnectionUri();
  try {
    await runMigrations(createTestEnvironment(databaseUrl));
    project.provide("databaseUrl", databaseUrl);
  } catch (error) {
    await container.stop();
    throw error;
  }

  return async () => {
    await container.stop();
  };
}
