import { describe, expect, it } from "vitest";

import { isCollectionShareToken } from "./sharing";

describe("collection share token validation", () => {
  it("accepts exactly one 256-bit base64url token and rejects malformed input", () => {
    expect(isCollectionShareToken("A".repeat(43))).toBe(true);
    expect(isCollectionShareToken(`${"A".repeat(42)}_`)).toBe(true);
    expect(isCollectionShareToken("A".repeat(42))).toBe(false);
    expect(isCollectionShareToken("A".repeat(44))).toBe(false);
    expect(isCollectionShareToken(`${"A".repeat(42)}+`)).toBe(false);
    expect(isCollectionShareToken("../private-collection")).toBe(false);
  });
});
