import "server-only";

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ImportedSticker } from "@/lib/csv";
import { createSchema } from "@/lib/schema";
import type { AlbumDetail, AlbumSummary, Collector, SectionView, StickerView } from "@/lib/types";

const databasePath = process.env.DATABASE_PATH ?? join(process.cwd(), "data", "stickerfolio.db");
let database: Database.Database | undefined;

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "album";
}

export function getDb(): Database.Database {
  if (database) return database;
  mkdirSync(dirname(databasePath), { recursive: true });
  database = new Database(databasePath);
  createSchema(database);
  return database;
}

export function getCollectors(): Collector[] {
  return getDb().prepare("SELECT id, slug, name FROM collectors ORDER BY created_at, id").all() as Collector[];
}

export function getCollector(collectorId: number): Collector | null {
  return (getDb().prepare("SELECT id, slug, name FROM collectors WHERE id = ?").get(collectorId) as Collector | undefined) ?? null;
}

export function createCollector(name: string): Collector {
  const db = getDb();
  const cleanName = name.trim();
  const baseSlug = slugify(cleanName);
  let slug = baseSlug;
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM collectors WHERE slug = ?").get(slug)) slug = `${baseSlug}-${suffix++}`;
  const id = Number(db.prepare("INSERT INTO collectors (slug, name) VALUES (?, ?)").run(slug, cleanName).lastInsertRowid);
  return { id, slug, name: cleanName };
}

const summaryQuery = `
  SELECT a.id, a.slug, a.name, a.description, c.id AS collectionId,
    COUNT(s.id) AS total,
    SUM(CASE WHEN h.quantity > 0 THEN 1 ELSE 0 END) AS owned,
    SUM(CASE WHEN h.quantity = 0 THEN 1 ELSE 0 END) AS missing,
    SUM(CASE WHEN h.quantity > 1 THEN 1 ELSE 0 END) AS duplicateCodes,
    SUM(CASE WHEN h.quantity > 1 THEN h.quantity - 1 ELSE 0 END) AS extraDuplicates
  FROM collections c
  JOIN albums a ON a.id = c.album_id
  JOIN stickers s ON s.album_id = a.id
  JOIN holdings h ON h.collection_id = c.id AND h.sticker_id = s.id
  WHERE c.collector_id = ?
  GROUP BY a.id, c.id
`;

export function getDashboard(collectorId: number): { collector: Collector; albums: AlbumSummary[] } | null {
  const db = getDb();
  const collector = getCollector(collectorId);
  if (!collector) return null;
  const albums = db.prepare(`${summaryQuery} ORDER BY a.created_at, a.id`).all(collector.id) as AlbumSummary[];
  return { collector, albums };
}

export function getAlbum(collectorId: number, albumId: number): AlbumDetail | null {
  const db = getDb();
  const album = db.prepare(`${summaryQuery} HAVING a.id = ?`).get(collectorId, albumId) as AlbumSummary | undefined;
  if (!album) return null;

  const sections = db.prepare(`
    SELECT sec.id, sec.code, sec.name, COUNT(s.id) AS total,
      SUM(CASE WHEN h.quantity > 0 THEN 1 ELSE 0 END) AS owned
    FROM sections sec
    JOIN stickers s ON s.section_id = sec.id
    JOIN holdings h ON h.sticker_id = s.id AND h.collection_id = ?
    WHERE sec.album_id = ?
    GROUP BY sec.id ORDER BY sec.sort_order
  `).all(album.collectionId, albumId) as SectionView[];

  const stickers = db.prepare(`
    SELECT s.id, s.code, s.number, s.label, h.quantity,
      sec.id AS sectionId, sec.code AS sectionCode, sec.name AS sectionName
    FROM stickers s
    JOIN sections sec ON sec.id = s.section_id
    JOIN holdings h ON h.sticker_id = s.id AND h.collection_id = ?
    WHERE s.album_id = ? ORDER BY s.sort_order
  `).all(album.collectionId, albumId) as StickerView[];

  return { ...album, sections, stickers };
}

export function updateHolding(collectorId: number, collectionId: number, stickerId: number, quantity: number): number {
  const db = getDb();
  const result = db.prepare(`
    UPDATE holdings SET quantity = ?, updated_at = CURRENT_TIMESTAMP
    WHERE collection_id = ? AND sticker_id = ?
      AND EXISTS (SELECT 1 FROM collections WHERE id = ? AND collector_id = ?)
  `).run(quantity, collectionId, stickerId, collectionId, collectorId);
  if (result.changes !== 1) throw new Error("Stickerbestand wurde nicht gefunden.");
  return quantity;
}

export function createAlbumForCollector(collectorId: number, name: string, description: string, stickers: ImportedSticker[]): number {
  const db = getDb();
  const collector = getCollector(collectorId);
  if (!collector) throw new Error("Bitte zuerst einen Sammler auswählen.");
  return db.transaction(() => {
    const baseSlug = slugify(name);
    let slug = baseSlug;
    let suffix = 2;
    while (db.prepare("SELECT 1 FROM albums WHERE slug = ?").get(slug)) slug = `${baseSlug}-${suffix++}`;
    const albumId = Number(db.prepare("INSERT INTO albums (slug, name, description) VALUES (?, ?, ?)").run(slug, name, description).lastInsertRowid);

    const uniqueSections = [...new Map(stickers.map((sticker) => [sticker.sectionCode, { code: sticker.sectionCode, name: sticker.sectionName }])).values()];
    const insertSection = db.prepare("INSERT INTO sections (album_id, code, name, sort_order) VALUES (?, ?, ?, ?)");
    uniqueSections.forEach((section, index) => insertSection.run(albumId, section.code, section.name, index));
    const sectionRows = db.prepare("SELECT id, code FROM sections WHERE album_id = ?").all(albumId) as Array<{ id: number; code: string }>;
    const sectionIds = new Map(sectionRows.map((section) => [section.code, section.id]));
    const insertSticker = db.prepare("INSERT INTO stickers (album_id, section_id, code, number, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)");
    stickers.forEach((sticker, index) => insertSticker.run(albumId, sectionIds.get(sticker.sectionCode), sticker.stickerCode, sticker.stickerNumber, sticker.label, index));

    const collectionId = Number(db.prepare("INSERT INTO collections (collector_id, album_id) VALUES (?, ?)").run(collector.id, albumId).lastInsertRowid);
    db.prepare("INSERT INTO holdings (collection_id, sticker_id, quantity) SELECT ?, id, 0 FROM stickers WHERE album_id = ?").run(collectionId, albumId);
    return albumId;
  })();
}
