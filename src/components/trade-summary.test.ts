import { describe, expect, it } from "vitest";

import { buildTradeQuery, describeMatch, formatRange, pageCount } from "./trade-summary";

describe("describeMatch", () => {
  it("labels two-way and one-way matches with receive/give counts", () => {
    expect(describeMatch({ kind: "two-way", offeredCount: 3, wantedCount: 2 })).toBe(
      "Two-way match: 3 to receive, 2 to give",
    );
    expect(describeMatch({ kind: "one-way", offeredCount: 0, wantedCount: 5 })).toBe(
      "One-way match: 0 to receive, 5 to give",
    );
  });
});

describe("formatRange", () => {
  it("shows the visible window of the total", () => {
    expect(formatRange(0, 20, 45)).toBe("1–20 of 45");
    expect(formatRange(20, 5, 25)).toBe("21–25 of 25");
  });

  it("collapses to zero when nothing is shown", () => {
    expect(formatRange(0, 0, 0)).toBe("0 of 0");
    expect(formatRange(40, 0, 30)).toBe("0 of 0");
  });
});

describe("buildTradeQuery", () => {
  it("omits defaults so canonical links stay empty", () => {
    expect(buildTradeQuery({ direction: "all", section: "", sort: "compatibility" }, 1)).toBe("");
  });

  it("serialises only non-default filters and pages beyond the first", () => {
    expect(
      buildTradeQuery({ direction: "two-way", section: "abc", sort: "wanted" }, 3),
    ).toBe("direction=two-way&section=abc&sort=wanted&page=3");
  });
});

describe("pageCount", () => {
  it("rounds up and never drops below one", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });
});
