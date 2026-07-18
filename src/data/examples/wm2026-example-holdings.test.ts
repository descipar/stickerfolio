import { describe, expect, it } from "vitest";

import { wm2026Template } from "@/data/wm2026";

import { wm2026ExampleHoldings } from "./wm2026-example-holdings";

describe("World Cup 2026 example holdings", () => {
  it("contains only known positive quantities and remains separate from the catalog", () => {
    const knownCodes = new Set(wm2026Template.stickers.map((sticker) => sticker.code));
    const entries = Object.entries(wm2026ExampleHoldings.quantities);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(wm2026Template.stickers.length);
    expect(entries.every(([code, quantity]) => knownCodes.has(code) && quantity >= 1 && quantity <= 3)).toBe(true);
    expect(wm2026Template).not.toHaveProperty("quantities");
  });
});
