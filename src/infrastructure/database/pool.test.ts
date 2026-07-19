import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../../test/create-test-environment";
import { createPool } from "./pool";

describe("PostgreSQL pool errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs an idle-client failure without leaking the database URL", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const environment = createTestEnvironment("postgresql://user:secret@database:5432/stickerfolio");
    const pool = createPool(environment);

    pool.emit("error", new Error("Connection failed for postgresql://user:secret@database:5432/stickerfolio"), {} as never);

    expect(output).toHaveBeenCalledOnce();
    const serialized = String(output.mock.calls[0]?.[0]);
    expect(serialized).toContain("database.pool.idle-client-error");
    expect(serialized).not.toContain("user:secret");
    await pool.end();
  });
});
