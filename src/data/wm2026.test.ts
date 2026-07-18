import { describe, expect, it } from "vitest";

import { parseAlbumTemplate } from "@/modules/catalog";

import { wm2026Template } from "./wm2026";

describe("World Cup 2026 catalog", () => {
  it("contains the verified 48 teams and 994 unique stickers", () => {
    expect(parseAlbumTemplate(wm2026Template)).toEqual(wm2026Template);
    expect(wm2026Template.sections).toHaveLength(50);
    expect(wm2026Template.stickers).toHaveLength(994);
    expect(new Set(wm2026Template.stickers.map((sticker) => sticker.code)).size).toBe(994);
    expect(wm2026Template.stickers[0]?.code).toBe("MEX1");
    expect(wm2026Template.stickers.at(-1)?.code).toBe("CC14");
  });
});
