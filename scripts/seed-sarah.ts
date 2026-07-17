import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { initialWm2026Quantity, wm2026Catalog, wm2026Sections } from "../src/data/wm2026";
import { createSchema } from "../src/lib/schema";

const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "stickerfolio.db");
const collectorArgument = process.argv.indexOf("--collector");
const collectorSlug = collectorArgument >= 0 ? process.argv[collectorArgument + 1]?.trim() : "";
if (!collectorSlug) {
  console.error("Aufruf: seed-sarah --collector <kennung>. Die Kennung steht in der Sammler-Verwaltung der App.");
  process.exit(1);
}

mkdirSync(dirname(databasePath), { recursive: true });
const database = new Database(databasePath);
createSchema(database);

const collector = database.prepare("SELECT id, name FROM collectors WHERE slug = ?").get(collectorSlug) as { id: number; name: string } | undefined;
if (!collector) {
  database.close();
  console.error(`Der Sammler „${collectorSlug}“ existiert nicht. Bitte zuerst in der App anlegen.`);
  process.exit(1);
}

const inserted = database.transaction(() => {
  database.prepare("INSERT OR IGNORE INTO albums (slug, name, description) VALUES (?, ?, ?)")
    .run("wm-2026", "Panini WM 2026", "994 Sticker · 48 Teams · Sondersticker");

  const albumId = (database.prepare("SELECT id FROM albums WHERE slug = 'wm-2026'").get() as { id: number }).id;

  const insertSection = database.prepare("INSERT OR IGNORE INTO sections (album_id, code, name, sort_order) VALUES (?, ?, ?, ?)");
  wm2026Sections.forEach((section, index) => insertSection.run(albumId, section.code, section.name, index));

  const sectionRows = database.prepare("SELECT id, code FROM sections WHERE album_id = ?").all(albumId) as Array<{ id: number; code: string }>;
  const sectionIds = new Map(sectionRows.map((section) => [section.code, section.id]));
  const insertSticker = database.prepare("INSERT OR IGNORE INTO stickers (album_id, section_id, code, number, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
  for (const sticker of wm2026Catalog) {
    insertSticker.run(albumId, sectionIds.get(sticker.sectionCode), sticker.code, String(sticker.number), sticker.label, sticker.sortOrder);
  }

  database.prepare("INSERT OR IGNORE INTO collections (collector_id, album_id) VALUES (?, ?)").run(collector.id, albumId);
  const collectionId = (database.prepare("SELECT id FROM collections WHERE collector_id = ? AND album_id = ?").get(collector.id, albumId) as { id: number }).id;
  const stickers = database.prepare("SELECT id, code FROM stickers WHERE album_id = ?").all(albumId) as Array<{ id: number; code: string }>;
  const insertHolding = database.prepare("INSERT OR IGNORE INTO holdings (collection_id, sticker_id, quantity) VALUES (?, ?, ?)");
  let holdings = 0;
  for (const sticker of stickers) holdings += insertHolding.run(collectionId, sticker.id, initialWm2026Quantity(sticker.code)).changes;
  return holdings;
})();

database.close();
console.log(inserted > 0
  ? `Sarahs WM-2026-Startbestand wurde für ${collector.name} geladen (${inserted} Sticker).`
  : `Der WM-2026-Startbestand für ${collector.name} war bereits vorhanden; es wurde nichts überschrieben.`);
