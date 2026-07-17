export type ImportedSticker = {
  sectionCode: string;
  sectionName: string;
  stickerCode: string;
  stickerNumber: string;
  label: string;
};

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  values.push(current.trim());
  return values;
}

export function parseAlbumCsv(csv: string): ImportedSticker[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("Die CSV enthält keine Sticker.");

  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const required = ["section_code", "section_name", "sticker_code", "sticker_number", "label"];
  const positions = Object.fromEntries(required.map((header) => [header, headers.indexOf(header)]));
  const missingHeaders = required.filter((header) => positions[header] === -1);
  if (missingHeaders.length) throw new Error(`Fehlende CSV-Spalten: ${missingHeaders.join(", ")}`);

  const seen = new Set<string>();
  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const sticker: ImportedSticker = {
      sectionCode: cells[positions.section_code]?.trim().toUpperCase() ?? "",
      sectionName: cells[positions.section_name]?.trim() ?? "",
      stickerCode: cells[positions.sticker_code]?.trim().toUpperCase() ?? "",
      stickerNumber: cells[positions.sticker_number]?.trim() ?? "",
      label: cells[positions.label]?.trim() ?? "",
    };
    if (!sticker.sectionCode || !sticker.sectionName || !sticker.stickerCode) {
      throw new Error(`Unvollständige Daten in CSV-Zeile ${index + 2}.`);
    }
    if (seen.has(sticker.stickerCode)) throw new Error(`Doppelter Stickercode: ${sticker.stickerCode}`);
    seen.add(sticker.stickerCode);
    return { ...sticker, label: sticker.label || sticker.stickerCode };
  });
}

export function escapeCsv(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
