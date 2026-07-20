import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import {
  closeDatabasePool,
  getPool,
  query,
  withTransaction,
} from "@/infrastructure/database";
import { runMigrations } from "@/infrastructure/database/migrations";
import { getReadinessStatus } from "@/infrastructure/observability";

import { createTestEnvironment } from "./create-test-environment";

const environment = createTestEnvironment(inject("databaseUrl"));

describe("PostgreSQL persistence", () => {
  beforeAll(async () => {
    await query(
      "CREATE TABLE integration_transactions (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, value text NOT NULL)",
      [],
      getPool(environment),
    );
  });

  afterAll(async () => {
    await query("DROP TABLE integration_transactions", [], getPool(environment));
    await closeDatabasePool();
  });

  it("runs the production migrations idempotently", async () => {
    const reapplied = await runMigrations(environment);
    expect(reapplied).toHaveLength(0);

    const result = await query<{ mustChangePassword: boolean }>(
      `SELECT "mustChangePassword" FROM "user" LIMIT 0`,
      [],
      getPool(environment),
    );
    expect(result.fields[0]?.name).toBe("mustChangePassword");
  });

  it("reuses the bounded runtime pool", () => {
    const first = getPool(environment);
    const second = getPool(environment);

    expect(first).toBe(second);
    expect(first.options.max).toBe(10);
  });

  it("executes parameterized queries against PostgreSQL", async () => {
    const result = await query<{ value: string }>(
      "SELECT $1::text AS value",
      ["safe parameter"],
      getPool(environment),
    );

    expect(result.rows).toEqual([{ value: "safe parameter" }]);
  });

  it("continues serving queries after an idle-client error event", async () => {
    const pool = getPool(environment);
    pool.emit("error", new Error("simulated idle client failure"), {} as never);

    const result = await query<{ value: number }>("SELECT 1::integer AS value", [], pool);
    expect(result.rows).toEqual([{ value: 1 }]);
  });

  it("reports readiness and the applied schema version", async () => {
    const status = await getReadinessStatus(getPool(environment));

    expect(status).toEqual({ status: "ready", app: "2.0.0-alpha.0", schema: "000006_onboarding_completion" });
  });

  it("commits successful transactions", async () => {
    await withTransaction(
      async (client) => {
        await query("INSERT INTO integration_transactions (value) VALUES ($1)", ["committed"], client);
      },
      getPool(environment),
    );

    const result = await query<{ value: string }>(
      "SELECT value FROM integration_transactions WHERE value = $1",
      ["committed"],
      getPool(environment),
    );
    expect(result.rows).toEqual([{ value: "committed" }]);
  });

  it("rolls back failed transactions and preserves the application error", async () => {
    const applicationError = new Error("operation failed");

    await expect(
      withTransaction(
        async (client) => {
          await query("INSERT INTO integration_transactions (value) VALUES ($1)", ["rolled back"], client);
          throw applicationError;
        },
        getPool(environment),
      ),
    ).rejects.toBe(applicationError);

    const result = await query<{ count: string }>(
      "SELECT count(*)::text AS count FROM integration_transactions WHERE value = $1",
      ["rolled back"],
      getPool(environment),
    );
    expect(result.rows[0]?.count).toBe("0");
  });
});
