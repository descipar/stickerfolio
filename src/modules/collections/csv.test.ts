import { describe, expect, it } from "vitest";

import { exportFileName, serializeCollectionExport, toCsv } from "./csv";
import type { CollectionExport } from "./repository";

describe("CSV serialization", () => {
  it("quotes fields containing commas, quotes, or line breaks", () => {
    const csv = toCsv(["a", "b"], [["plain", 'has "quote", comma']]);
    expect(csv).toBe('a,b\r\nplain,"has ""quote"", comma"\r\n');
  });

  it("emits a header-only file for an empty missing list", () => {
    const data: CollectionExport = {
      albumTitle: "Album",
      albumSlug: "album",
      revisionNumber: 1,
      type: "missing",
      stickers: [],
    };
    expect(serializeCollectionExport(data)).toBe("code,name,section_code,section\r\n");
  });

  it("includes quantity and spare_count for duplicates", () => {
    const data: CollectionExport = {
      albumTitle: "Album",
      albumSlug: "album",
      revisionNumber: 1,
      type: "duplicates",
      stickers: [
        { code: "A1", label: "One", sectionCode: "A", sectionName: "Team A", quantity: 3, spareCount: 2 },
      ],
    };
    expect(serializeCollectionExport(data)).toBe(
      "code,name,section_code,section,quantity,spare_count\r\nA1,One,A,Team A,3,2\r\n",
    );
    expect(exportFileName(data)).toBe("album-duplicates.csv");
  });
});
