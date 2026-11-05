import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminError } from "@/modules/admin";
import { CollectionError } from "@/modules/collections";

import { apiError } from "./http";

describe("API error mapping", () => {
  afterEach(() => vi.restoreAllMocks());

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
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(apiError(new Error("unexpected")).status).toBe(500);
  });

  it("logs one redacted line with the route for an unexpected failure", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const request = new Request(
      "http://localhost/api/collections/0f8fad5b-d9cb-469f-a165-70867728950e/holdings/sticker-identity-abcdef123",
      { method: "PUT" },
    );
    const response = apiError(
      new Error("connect failed postgresql://stickerfolio:secret@db/stickerfolio"),
      request,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "The request could not be completed." });
    expect(output).toHaveBeenCalledOnce();
    const line = JSON.parse(String(output.mock.calls[0]![0]));
    expect(line).toMatchObject({
      level: "error",
      event: "api.unexpected_error",
      route: "PUT /api/collections/:id/holdings/:id",
      error: { name: "Error", message: "connect failed postgresql://<redacted>" },
    });
    expect(JSON.stringify(line)).not.toContain("secret");
  });

  it("does not log expected domain errors", () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    apiError(new CollectionError("Invalid quantity."));
    expect(output).not.toHaveBeenCalled();
  });
});
