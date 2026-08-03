import { describe, expect, it, vi } from "vitest";

import { DirectComparisonError } from "@/modules/trading";

import { handleDirectComparisonRequest } from "./result/route";
import { handleComparisonSetupRequest } from "./setup/route";

const collectionId = "af6c26f8-a21f-4db5-9bc8-4b4d95c30c58";

describe("direct comparison API validation", () => {
  it("accepts exactly one bounded credential when preparing", async () => {
    const loadSetup = vi.fn(async () => ({
      collections: [{ id: collectionId, albumTitle: "Album", revisionNumber: 2 }],
    }));
    const valid = await handleComparisonSetupRequest(
      new Request("http://localhost/api/comparisons/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "ABCDE-23456" }),
      }),
      loadSetup,
    );
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ setup: { collections: [{ id: collectionId }] } });
    expect(loadSetup).toHaveBeenCalledWith(expect.any(Headers), { code: "ABCDE-23456" });

    for (const body of [{}, { token: "token", code: "code" }, { code: "A".repeat(33) }]) {
      const invalid = await handleComparisonSetupRequest(
        new Request("http://localhost/api/comparisons/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        loadSetup,
      );
      expect(invalid.status).toBe(404);
    }
  });

  it("returns only the comparison projection and hides invalid selections", async () => {
    const loadComparison = vi.fn(async () => ({
      albumTitle: "Album",
      partnerDisplayName: "Partner",
      kind: "none" as const,
      offersToYou: [],
      needsFromYou: [],
      offeredCount: 0,
      wantedCount: 0,
    }));
    const response = await handleDirectComparisonRequest(
      new Request("http://localhost/api/comparisons/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, token: "A".repeat(43) }),
      }),
      loadComparison,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      result: {
        albumTitle: "Album",
        partnerDisplayName: "Partner",
        kind: "none",
        offersToYou: [],
        needsFromYou: [],
        offeredCount: 0,
        wantedCount: 0,
      },
    });

    const invalid = await handleDirectComparisonRequest(
      new Request("http://localhost/api/comparisons/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId: "foreign", token: "A".repeat(43) }),
      }),
      loadComparison,
    );
    expect(invalid.status).toBe(404);

    const unavailable = await handleDirectComparisonRequest(
      new Request("http://localhost/api/comparisons/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectionId, token: "A".repeat(43) }),
      }),
      async () => { throw new DirectComparisonError(); },
    );
    expect(unavailable.status).toBe(404);
    expect(await unavailable.json()).toEqual({ error: "Comparison unavailable." });
  });
});
