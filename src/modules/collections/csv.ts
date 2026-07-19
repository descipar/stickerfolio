import type { CollectionExport } from "./repository";

/**
 * Minimal RFC 4180 CSV serializer. Fields containing a comma, double quote, or
 * line break are wrapped in double quotes with embedded quotes doubled. Records
 * are separated with CRLF and a trailing CRLF is emitted. Output is UTF-8
 * without a byte-order mark; an empty row set still yields the header line.
 */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  return [header, ...rows].map((row) => row.map(serializeField).join(",")).join("\r\n") + "\r\n";
}

function serializeField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Serializes a collection export to CSV. The missing list carries the sticker
 * code, name, and section; the duplicates list adds quantity and spare_count
 * (quantity - 1), the copies available to swap.
 */
export function serializeCollectionExport(data: CollectionExport): string {
  if (data.type === "duplicates") {
    return toCsv(
      ["code", "name", "section_code", "section", "quantity", "spare_count"],
      data.stickers.map((sticker) => [
        sticker.code,
        sticker.label,
        sticker.sectionCode,
        sticker.sectionName,
        sticker.quantity,
        sticker.spareCount,
      ]),
    );
  }
  return toCsv(
    ["code", "name", "section_code", "section"],
    data.stickers.map((sticker) => [
      sticker.code,
      sticker.label,
      sticker.sectionCode,
      sticker.sectionName,
    ]),
  );
}

/** Documented download file name, e.g. `world-cup-2026-missing.csv`. */
export function exportFileName(data: CollectionExport): string {
  return `${data.albumSlug}-${data.type}.csv`;
}
