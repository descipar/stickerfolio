import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestEnvironment } from "../../../test/create-test-environment";
import { createPgClientConfig, createPool } from "./pool";

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

  it("keeps verified TLS strict and require mode explicitly unverified", () => {
    const environment = createTestEnvironment(
      "postgresql://user:secret@database.example.com:5432/stickerfolio",
    );

    const verified = createPgClientConfig({
      ...environment.database,
      sslMode: "verify-full",
      certificateAuthority: "trusted provider CA",
    });
    expect(verified.ssl).toEqual({
      rejectUnauthorized: true,
      ca: "trusted provider CA",
    });

    const encryptedOnly = createPgClientConfig({
      ...environment.database,
      sslMode: "require",
    });
    expect(encryptedOnly.ssl).toEqual({ rejectUnauthorized: false });
  });
});
