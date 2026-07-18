import { describe, expect, it } from "vitest";
import { expandNumberSpec } from "./catalog";
import { initialWm2026Quantity, wm2026Catalog, wm2026DuplicateCodes, wm2026MissingCodes } from "../data/wm2026";

describe("Katalog-Helfer", () => {
  it("erweitert Nummernbereiche", () => {
    expect(expandNumberSpec("1,3-5,9")).toEqual([1, 3, 4, 5, 9]);
  });

  it("enthält den vollständigen WM-2026-Katalog", () => {
    expect(wm2026Catalog).toHaveLength(994);
    expect(new Set(wm2026Catalog.map((sticker) => sticker.code)).size).toBe(994);
    expect(wm2026Catalog.some((sticker) => sticker.code === "FWC00")).toBe(true);
    expect(wm2026Catalog.some((sticker) => sticker.code === "CC14")).toBe(true);
  });

  it("übernimmt den Beispiel-Startbestand", () => {
    expect(wm2026MissingCodes.size).toBe(344);
    expect(wm2026DuplicateCodes.size).toBe(124);
    expect(initialWm2026Quantity("GER12")).toBe(0);
    expect(initialWm2026Quantity("MEX10")).toBe(3);
    expect(initialWm2026Quantity("GER1")).toBe(2);
    expect(initialWm2026Quantity("GER2")).toBe(1);
  });
});
