import { describe, expect, it } from "vitest";

import { isAbortError } from "./admin-registration";

describe("isAbortError", () => {
  it("ignores the abort raised when the AbortController tears down the fetch", () => {
    // fetch() aborted via AbortController rejects with an AbortError.
    expect(isAbortError(new DOMException("The operation was aborted.", "AbortError"))).toBe(true);
  });

  it("surfaces genuine connection failures so loading does not hang forever", () => {
    expect(isAbortError(new TypeError("Failed to fetch"))).toBe(false);
    expect(isAbortError(new Error("connection reset"))).toBe(false);
  });

  it("surfaces non-error rejection values", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError({})).toBe(false);
  });
});
