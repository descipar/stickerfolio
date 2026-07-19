import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("admin album import request limits", () => {
  it("rejects a declared body larger than 2 MB before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/admin/albums", {
      method: "POST",
      headers: { "content-length": String(2 * 1024 * 1024 + 1) },
      body: "{}",
    }));

    expect(response.status).toBe(413);
  });

  it("rejects malformed JSON with a readable error", async () => {
    const response = await POST(new Request("http://localhost/api/admin/albums", {
      method: "POST",
      body: "not-json",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "The album template is not valid JSON." });
  });
});
