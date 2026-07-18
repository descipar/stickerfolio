import { afterEach, describe, expect, it, vi } from "vitest";

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
});
