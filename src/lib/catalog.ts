export type CatalogSection = {
  code: string;
  name: string;
  stickerNumbers: number[];
  numberWidth?: number;
};

export type CatalogSticker = {
  sectionCode: string;
  sectionName: string;
  code: string;
  number: number;
  label: string;
  sortOrder: number;
};

export function expandNumberSpec(spec: string): number[] {
  if (!spec.trim()) return [];

  const numbers = new Set<number>();
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;

    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > end) throw new Error(`Ungültiger Bereich: ${part}`);
      for (let value = start; value <= end; value += 1) numbers.add(value);
      continue;
    }

    if (!/^\d+$/.test(part)) throw new Error(`Ungültige Nummer: ${part}`);
    numbers.add(Number(part));
  }

  return [...numbers].sort((a, b) => a - b);
}

export function buildCatalog(sections: CatalogSection[]): CatalogSticker[] {
  let sortOrder = 0;
  return sections.flatMap((section) =>
    section.stickerNumbers.map((number) => {
      sortOrder += 1;
      const formattedNumber = section.numberWidth
        ? String(number).padStart(section.numberWidth, "0")
        : String(number);
      const code = `${section.code}${formattedNumber}`;
      return {
        sectionCode: section.code,
        sectionName: section.name,
        code,
        number,
        label: code,
        sortOrder,
      };
    }),
  );
}
