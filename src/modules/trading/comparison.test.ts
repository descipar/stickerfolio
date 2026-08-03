import { describe, expect, it } from "vitest";

import { isComparisonToken, normalizeComparisonCode } from "./comparison";

describe("direct comparison credentials", () => {
  it("accepts one opaque token and rejects malformed values", () => {
    expect(isComparisonToken("A".repeat(43))).toBe(true);
    expect(isComparisonToken(`${"A".repeat(42)}_`)).toBe(true);
    expect(isComparisonToken("A".repeat(42))).toBe(false);
    expect(isComparisonToken(`${"A".repeat(42)}+`)).toBe(false);
  });

  it("normalizes manual codes while excluding ambiguous and malformed characters", () => {
    expect(normalizeComparisonCode("abcde-23456")).toBe("ABCDE23456");
    expect(normalizeComparisonCode("ABCDE 23456")).toBe("ABCDE23456");
    expect(normalizeComparisonCode("ABCDE-O3456")).toBeNull();
    expect(normalizeComparisonCode("short")).toBeNull();
  });
});
