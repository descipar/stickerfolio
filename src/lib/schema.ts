import type Database from "better-sqlite3";

export function createSchema(db: Database.Database) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS collectors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(album_id, code)
    );
    CREATE TABLE IF NOT EXISTS stickers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
      code TEXT NOT NULL,
      number TEXT NOT NULL DEFAULT '',
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      UNIQUE(album_id, code)
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collector_id INTEGER NOT NULL REFERENCES collectors(id) ON DELETE CASCADE,
      album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(collector_id, album_id)
    );
    CREATE TABLE IF NOT EXISTS holdings (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      sticker_id INTEGER NOT NULL REFERENCES stickers(id) ON DELETE CASCADE,
      quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0 AND quantity <= 99),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(collection_id, sticker_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stickers_album ON stickers(album_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_holdings_collection ON holdings(collection_id, quantity);
  `);
}
