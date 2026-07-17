import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { initialWm2026Quantity, wm2026Catalog, wm2026Sections } from "../src/data/wm2026";
import { createSchema } from "../src/lib/schema";

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "sammler";
}

const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "stickerfolio.db");
const collectorName = process.env.COLLECTOR_NAME?.trim() || "Sarah";
const collectorSlug = process.env.COLLECTOR_SLUG?.trim() || slugify(collectorName);

mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
createSchema(database);

const inserted = database.transaction(() => {
  database.prepare("INSERT OR IGNORE INTO collectors (slug, name) VALUES (?, ?)").run(collectorSlug, collectorName);
  database.prepare("INSERT OR IGNORE INTO albums (slug, name, description) VALUES (?, ?, ?)")
    .run("wm-2026", "Panini WM 2026", "994 Sticker · 48 Teams · Sondersticker");

  const collectorId = (database.prepare("SELECT id FROM collectors WHERE slug = ?").get(collectorSlug) as { id: number }).id;
  const albumId = (database.prepare("SELECT id FROM albums WHERE slug = 'wm-2026'").get() as { id: number }).id;

  const insertSection = database.prepare("INSERT OR IGNORE INTO sections (album_id, code, name, sort_order) VALUES (?, ?, ?, ?)");
  wm2026Sections.forEach((section, index) => insertSection.run(albumId, section.code, section.name, index));

  const sectionRows = database.prepare("SELECT id, code FROM sections WHERE album_id = ?").all(albumId) as Array<{ id: number; code: string }>;
  const sectionIds = new Map(sectionRows.map((section) => [section.code, section.id]));
  const insertSticker = database.prepare("INSERT OR IGNORE INTO stickers (album_id, section_id, code, number, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
  for (const sticker of wm2026Catalog) {
    insertSticker.run(albumId, sectionIds.get(sticker.sectionCode), sticker.code, String(sticker.number), sticker.label, sticker.sortOrder);
  }

  database.prepare("INSERT OR IGNORE INTO collections (collector_id, album_id) VALUES (?, ?)").run(collectorId, albumId);
  const collectionId = (database.prepare("SELECT id FROM collections WHERE collector_id = ? AND album_id = ?").get(collectorId, albumId) as { id: number }).id;
  const stickers = database.prepare("SELECT id, code FROM stickers WHERE album_id = ?").all(albumId) as Array<{ id: number; code: string }>;
  const insertHolding = database.prepare("INSERT OR IGNORE INTO holdings (collection_id, sticker_id, quantity) VALUES (?, ?, ?)");
  let holdings = 0;
  for (const sticker of stickers) holdings += insertHolding.run(collectionId, sticker.id, initialWm2026Quantity(sticker.code)).changes;
  return holdings;
})();

database.close();
console.log(inserted > 0
  ? `Sarahs WM-2026-Startbestand wurde für ${collectorName} geladen (${inserted} Sticker).`
  : `Der WM-2026-Startbestand für ${collectorName} war bereits vorhanden; es wurde nichts überschrieben.`);
