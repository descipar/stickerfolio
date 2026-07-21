import { describe, expect, it } from "vitest";

import { parseAlbumTemplate } from "@/modules/catalog";

import { euro2024Template } from "./euro2024";

describe("Topps UEFA EURO 2024 catalog", () => {
  it("contains the 707 unique physical sticker carriers from the standard German edition", () => {
    expect(parseAlbumTemplate(euro2024Template)).toEqual(euro2024Template);
    expect(euro2024Template.sections).toHaveLength(43);
    expect(euro2024Template.stickers).toHaveLength(707);
    expect(new Set(euro2024Template.stickers.map((sticker) => sticker.code)).size).toBe(707);
    expect(euro2024Template.stickers[0]?.code).toBe("TOPPS1");
    expect(euro2024Template.stickers.at(-1)?.code).toBe("LEG10");
  });

  it("tracks combined carrier sheets and excludes optional parallel variants", () => {
    const codes = new Set(euro2024Template.stickers.map((sticker) => sticker.code));

    expect(codes).toContain("GA1+2");
    expect(codes).toContain("MM1+2");
    expect(codes).toContain("POL2+3");
    expect(codes).toContain("POL14+15");
    expect(codes).not.toContain("GA1");
    expect(codes).not.toContain("POL2");
    expect([...codes].some((code) => code.includes("SIGNATURE") || code.includes("GOLD"))).toBe(false);
  });
});
