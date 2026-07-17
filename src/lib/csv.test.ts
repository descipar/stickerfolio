import { describe, expect, it } from "vitest";
import { parseAlbumCsv } from "./csv";

describe("Album-CSV", () => {
  it("liest den generischen Albumkatalog", () => {
    const result = parseAlbumCsv("section_code,section_name,sticker_code,sticker_number,label\nGER,Deutschland,GER1,1,Spieler 1");
    expect(result).toEqual([{ sectionCode: "GER", sectionName: "Deutschland", stickerCode: "GER1", stickerNumber: "1", label: "Spieler 1" }]);
  });

  it("weist doppelte Codes zurück", () => {
    expect(() => parseAlbumCsv("section_code,section_name,sticker_code,sticker_number,label\nA,A,A1,1,A1\nA,A,A1,1,A1"))
      .toThrow("Doppelter Stickercode");
  });
});
