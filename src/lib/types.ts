export type AlbumSummary = {
  id: number;
  slug: string;
  name: string;
  description: string;
  collectionId: number;
  total: number;
  owned: number;
  missing: number;
  duplicateCodes: number;
  extraDuplicates: number;
};

export type StickerView = {
  id: number;
  code: string;
  number: string;
  label: string;
  quantity: number;
  sectionId: number;
  sectionCode: string;
  sectionName: string;
};

export type SectionView = {
  id: number;
  code: string;
  name: string;
  total: number;
  owned: number;
};

export type AlbumDetail = AlbumSummary & {
  sections: SectionView[];
  stickers: StickerView[];
};
