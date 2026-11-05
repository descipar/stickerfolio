import { afterEach, describe, expect, it, vi } from "vitest";

import { classifySchema } from "@/infrastructure/observability";

import { createReadinessResponse } from "./route";

describe("readiness endpoint", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns service unavailable without leaking database errors", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await createReadinessResponse(async () => {
      throw new Error("postgresql://user:password@database/stickerfolio");
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
  });

  it("is not ready while the database is missing an expected migration", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await createReadinessResponse(async () => ({
      status: "not_ready",
      app: "test",
      schema: "000001_initial_identity",
      expectedSchema: "000002_catalog_and_collections",
      schemaState: "behind",
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready", schemaState: "behind" });
  });

  it("stays ready on a newer schema so a previous image can serve after rollback", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const response = await createReadinessResponse(async () => ({
      status: "ready",
      app: "test",
      schema: "000099_future",
      expectedSchema: "000009_active_collector_profiles",
      schemaState: "ahead",
    }));

    expect(response.status).toBe(200);
  });
});

describe("schema classification", () => {
  const expected = ["000001_a", "000002_b"];

  it("distinguishes current, ahead, and behind schemas", () => {
    expect(classifySchema(["000002_b", "000001_a"], expected)).toBe("current");
    expect(classifySchema(["000003_c", "000002_b", "000001_a"], expected)).toBe("ahead");
    expect(classifySchema(["000001_a"], expected)).toBe("behind");
    expect(classifySchema([], expected)).toBe("behind");
    expect(classifySchema(["000001_a", "000003_c"], expected)).toBe("behind");
  });
});
