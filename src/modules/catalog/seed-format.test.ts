import { describe, expect, it } from "vitest";

import { parseAlbumTemplate } from "./seed-format";

const validTemplate = {
  formatVersion: 1,
  album: {
    id: "16cdf0a0-d4d7-5e58-8e49-f2c8455be4fb",
    slug: "example-album",
    title: "Example album",
  },
  revision: {
    id: "017b7165-f89f-55aa-a2ca-4139b59bfbca",
    number: 1,
    label: "First edition",
    status: "published",
  },
  sections: [
    {
      id: "26bdb46d-24f4-59f1-ae22-343473f7baef",
      code: "EX",
      name: "Examples",
      sortOrder: 0,
    },
  ],
  stickers: [
    {
      stableId: "06cdf614-184d-5e91-a65f-3f9d40f5fb50",
      stableKey: "example-1",
      sectionId: "26bdb46d-24f4-59f1-ae22-343473f7baef",
      code: "EX1",
      label: "Example 1",
      sortOrder: 0,
    },
  ],
} as const;

describe("portable album template format", () => {
  it("accepts an unambiguous provider-neutral template", () => {
    expect(parseAlbumTemplate(validTemplate)).toEqual(validTemplate);
  });

  it("rejects duplicate sticker codes", () => {
    expect(() =>
      parseAlbumTemplate({
        ...validTemplate,
        stickers: [validTemplate.stickers[0], { ...validTemplate.stickers[0], stableId: "2d650325-13a1-59ef-8607-2c6cb59f8a55", stableKey: "example-2" }],
      }),
    ).toThrow("Duplicate sticker code");
  });

  it("rejects unknown section references", () => {
    expect(() =>
      parseAlbumTemplate({
        ...validTemplate,
        stickers: [{ ...validTemplate.stickers[0], sectionId: "daa0ed98-cf2f-50da-a524-3b0c70e84d23" }],
      }),
    ).toThrow("unknown section");
  });
});
