import { describe, expect, it } from "vitest";

import { AdminError } from "@/modules/admin";
import { CollectionError } from "@/modules/collections";

import { apiError } from "./http";

describe("API error mapping", () => {
  it("uses the typed collection status independently of message wording", async () => {
    const response = apiError(new CollectionError("This wording may change.", 404));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Collection not found." });
  });

  it("maps collection validation errors to 400", () => {
    expect(apiError(new CollectionError("Invalid quantity.")).status).toBe(400);
  });

  it("maps database failures to a data-minimized temporary failure", async () => {
    const response = apiError(new AdminError("The service is temporarily unavailable.", 503));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "The service is temporarily unavailable." });
  });

  it("maps unexpected failures to 500", () => {
    expect(apiError(new Error("unexpected")).status).toBe(500);
  });
});
