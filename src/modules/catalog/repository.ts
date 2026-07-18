import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";

import { parseAlbumTemplate, type AlbumTemplate } from "./seed-format";

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

export interface SeedResult {
  created: boolean;
  albumId: string;
  revisionId: string;
  sections: number;
  stickers: number;
}

async function insertTemplate(client: PoolClient, template: AlbumTemplate): Promise<SeedResult> {
  const existing = await query<{ album_id: string; revision_number: number; status: string }>(
    `SELECT album_id, revision_number, status FROM album_revisions WHERE id = $1`,
    [template.revision.id],
    client,
  );
  if (existing.rows[0]) {
    const revision = existing.rows[0];
    if (revision.album_id !== template.album.id || revision.revision_number !== template.revision.number) {
      throw new CatalogError("The template revision ID is already used by a different catalog revision.");
    }
    return {
      created: false,
      albumId: template.album.id,
      revisionId: template.revision.id,
      sections: template.sections.length,
      stickers: template.stickers.length,
    };
  }

  await query(
    `INSERT INTO albums (id, slug, title, description)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [template.album.id, template.album.slug, template.album.title, template.album.description ?? null],
    client,
  );
  const album = await query<{ slug: string }>("SELECT slug FROM albums WHERE id = $1", [template.album.id], client);
  if (album.rows[0]?.slug !== template.album.slug) {
    throw new CatalogError("The template album ID conflicts with an existing album.");
  }

  await query(
    `INSERT INTO album_revisions (id, album_id, revision_number, label, status)
     VALUES ($1, $2, $3, $4, 'draft')`,
    [template.revision.id, template.album.id, template.revision.number, template.revision.label],
    client,
  );

  for (const section of template.sections) {
    await query(
      `INSERT INTO album_sections (id, album_id, revision_id, code, name, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [section.id, template.album.id, template.revision.id, section.code, section.name, section.sortOrder],
      client,
    );
  }

  for (const sticker of template.stickers) {
    await query(
      `INSERT INTO stickers (id, album_id, stable_key) VALUES ($1, $2, $3)
       ON CONFLICT (album_id, stable_key) DO NOTHING`,
      [sticker.stableId, template.album.id, sticker.stableKey],
      client,
    );
    const identity = await query<{ id: string }>(
      "SELECT id FROM stickers WHERE album_id = $1 AND stable_key = $2",
      [template.album.id, sticker.stableKey],
      client,
    );
    if (identity.rows[0]?.id !== sticker.stableId) {
      throw new CatalogError(`Stable sticker key ${sticker.stableKey} conflicts with an existing ID.`);
    }
    await query(
      `INSERT INTO album_revision_stickers
         (album_id, revision_id, sticker_id, section_id, code, label, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        template.album.id,
        template.revision.id,
        sticker.stableId,
        sticker.sectionId,
        sticker.code,
        sticker.label,
        sticker.sortOrder,
      ],
      client,
    );
  }

  if (template.revision.status === "published") {
    await query("UPDATE album_revisions SET status = 'published' WHERE id = $1", [template.revision.id], client);
  }

  return {
    created: true,
    albumId: template.album.id,
    revisionId: template.revision.id,
    sections: template.sections.length,
    stickers: template.stickers.length,
  };
}

export async function seedAlbumTemplate(input: unknown, pool: Pool = getPool()): Promise<SeedResult> {
  const template = parseAlbumTemplate(input);
  return withTransaction((client) => insertTemplate(client, template), pool);
}

export async function publishRevision(revisionId: string, executor?: QueryExecutor): Promise<void> {
  const result = await query(
    "UPDATE album_revisions SET status = 'published' WHERE id = $1 AND status = 'draft'",
    [revisionId],
    executor,
  );
  if (result.rowCount !== 1) throw new CatalogError("Draft revision not found or cannot be published.");
}

export async function archiveRevision(revisionId: string, executor?: QueryExecutor): Promise<void> {
  const result = await query(
    "UPDATE album_revisions SET status = 'archived' WHERE id = $1 AND status = 'published'",
    [revisionId],
    executor,
  );
  if (result.rowCount !== 1) throw new CatalogError("Published revision not found or cannot be archived.");
}

export async function getCurrentRevision(
  albumId: string,
  executor?: QueryExecutor,
): Promise<{ id: string; revisionNumber: number } | null> {
  const result = await query<{ id: string; revision_number: number }>(
    `SELECT id, revision_number FROM album_revisions
     WHERE album_id = $1 AND status = 'published'`,
    [albumId],
    executor,
  );
  const revision = result.rows[0];
  return revision ? { id: revision.id, revisionNumber: revision.revision_number } : null;
}
