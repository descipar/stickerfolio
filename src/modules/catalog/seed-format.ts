import { z } from "zod";

const identifier = z.uuid();
const nonEmptyText = z.string().trim().min(1);

export const albumTemplateSchema = z
  .object({
    formatVersion: z.literal(1),
    album: z.object({
      id: identifier,
      slug: nonEmptyText.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
      title: nonEmptyText,
      description: z.string().trim().optional(),
    }),
    revision: z.object({
      id: identifier,
      number: z.number().int().positive(),
      label: nonEmptyText,
      status: z.enum(["draft", "published"]),
    }),
    sections: z
      .array(
        z.object({
          id: identifier,
          code: nonEmptyText,
          name: nonEmptyText,
          sortOrder: z.number().int().nonnegative(),
        }),
      )
      .min(1),
    stickers: z
      .array(
        z.object({
          stableId: identifier,
          stableKey: nonEmptyText,
          sectionId: identifier,
          code: nonEmptyText,
          label: nonEmptyText,
          sortOrder: z.number().int().nonnegative(),
        }),
      )
      .min(1),
  })
  .superRefine((template, context) => {
    const sectionIds = new Set<string>();
    const sectionCodes = new Set<string>();
    const sectionSortOrders = new Set<number>();
    template.sections.forEach((section, index) => {
      for (const [value, seen, field] of [
        [section.id, sectionIds, "id"],
        [section.code, sectionCodes, "code"],
        [section.sortOrder, sectionSortOrders, "sortOrder"],
      ] as const) {
        if (seen.has(value as never)) {
          context.addIssue({ code: "custom", path: ["sections", index, field], message: `Duplicate section ${field}` });
        }
        seen.add(value as never);
      }
    });

    const stickerIds = new Set<string>();
    const stableKeys = new Set<string>();
    const stickerCodes = new Set<string>();
    const stickerSortOrders = new Set<number>();
    template.stickers.forEach((sticker, index) => {
      if (!sectionIds.has(sticker.sectionId)) {
        context.addIssue({
          code: "custom",
          path: ["stickers", index, "sectionId"],
          message: "Sticker references an unknown section",
        });
      }
      for (const [value, seen, field] of [
        [sticker.stableId, stickerIds, "stableId"],
        [sticker.stableKey, stableKeys, "stableKey"],
        [sticker.code, stickerCodes, "code"],
        [sticker.sortOrder, stickerSortOrders, "sortOrder"],
      ] as const) {
        if (seen.has(value as never)) {
          context.addIssue({ code: "custom", path: ["stickers", index, field], message: `Duplicate sticker ${field}` });
        }
        seen.add(value as never);
      }
    });
  });

export type AlbumTemplate = z.infer<typeof albumTemplateSchema>;

export function parseAlbumTemplate(input: unknown): AlbumTemplate {
  return albumTemplateSchema.parse(input);
}
