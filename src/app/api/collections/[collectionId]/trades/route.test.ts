import { describe, expect, it, vi } from "vitest";

import { handleTradeMatchesRequest } from "./route";

const collectionId = "18b8e61c-001e-47a3-8cfc-deaa52117295";
const emptyResult = {
  collection: { id: collectionId, albumTitle: "Test album" },
  enabled: true,
  sections: [],
  matches: [],
  total: 0,
  limit: 20,
  offset: 0,
};

describe("trade matching API filters", () => {
  it("rejects invalid collection identifiers and filters before loading data", async () => {
    const load = vi.fn();
    const invalidId = await handleTradeMatchesRequest(
      new Request("http://localhost/api/collections/not-an-id/trades"),
      "not-an-id",
      load,
    );
    const invalidFilters = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${collectionId}/trades?limit=500`),
      collectionId,
      load,
    );

    expect(invalidId.status).toBe(404);
    expect(invalidFilters.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });

  it("passes bounded pagination, section, direction, and sorting to the matching core", async () => {
    const load = vi.fn().mockResolvedValue({ ...emptyResult, limit: 10, offset: 20 });
    const sectionId = "9a84b353-6016-50ad-9c61-3709be3272ad";
    const response = await handleTradeMatchesRequest(
      new Request(`http://localhost/api/collections/${collectionId}/trades?direction=two-way&section=${sectionId}&sort=wanted&limit=10&offset=20`),
      collectionId,
      load,
    );

    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(expect.any(Headers), collectionId, {
      direction: "two-way",
      sectionId,
      sort: "wanted",
      limit: 10,
      offset: 20,
    });
  });
});
