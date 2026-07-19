import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";

import { parseAlbumTemplate, type AlbumTemplate } from "./seed-format";

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
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

export interface PublishedAlbumSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  revisionId: string;
  revisionNumber: number;
  stickerCount: number;
}

export interface ManagedAlbumRevision {
  id: string;
  number: number;
  label: string;
  status: "draft" | "published" | "archived";
  sectionCount: number;
  stickerCount: number;
  publishedAt: string | null;
  archivedAt: string | null;
}

export interface ManagedAlbumSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  revisions: ManagedAlbumRevision[];
}

async function insertTemplate(
  client: PoolClient,
  template: AlbumTemplate,
  options: { allowExisting: boolean },
): Promise<SeedResult> {
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
    if (!options.allowExisting) {
      throw new CatalogError("The template revision has already been imported.", 409);
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
  return withTransaction((client) => insertTemplate(client, template, { allowExisting: true }), pool);
}

export async function importAlbumTemplate(input: unknown, pool: Pool = getPool()): Promise<SeedResult> {
  let template: AlbumTemplate;
  try {
    const parsed = parseAlbumTemplate(input);
    template = { ...parsed, revision: { ...parsed.revision, status: "draft" } };
  } catch (error) {
    if (error instanceof ZodError) {
      const details = error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join(".") || "template"}: ${issue.message}`)
        .join("; ");
      throw new CatalogError(`Invalid album template. ${details}`);
    }
    throw error;
  }
  return withTransaction((client) => insertTemplate(client, template, { allowExisting: false }), pool);
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

export async function publishRevisionAndArchiveCurrent(revisionId: string, pool: Pool = getPool()): Promise<void> {
  await withTransaction(async (client) => {
    const target = await query<{ album_id: string; status: string }>(
      "SELECT album_id, status FROM album_revisions WHERE id = $1 FOR UPDATE",
      [revisionId],
      client,
    );
    if (!target.rows[0] || target.rows[0].status !== "draft") {
      throw new CatalogError("Draft revision not found or cannot be published.", 404);
    }
    await query(
      "UPDATE album_revisions SET status = 'archived' WHERE album_id = $1 AND status = 'published'",
      [target.rows[0].album_id],
      client,
    );
    await publishRevision(revisionId, client);
  }, pool);
}

export async function listManagedAlbums(executor?: QueryExecutor): Promise<ManagedAlbumSummary[]> {
  const result = await query<{
    album_id: string;
    slug: string;
    title: string;
    description: string | null;
    revision_id: string;
    revision_number: number;
    revision_label: string;
    status: ManagedAlbumRevision["status"];
    section_count: number;
    sticker_count: number;
    published_at: Date | null;
    archived_at: Date | null;
  }>(
    `SELECT a.id AS album_id, a.slug, a.title, a.description,
            r.id AS revision_id, r.revision_number, r.label AS revision_label, r.status,
            count(DISTINCT s.id)::integer AS section_count,
            count(DISTINCT rs.sticker_id)::integer AS sticker_count,
            r.published_at, r.archived_at
       FROM albums a
       JOIN album_revisions r ON r.album_id = a.id
       LEFT JOIN album_sections s ON s.revision_id = r.id
       LEFT JOIN album_revision_stickers rs ON rs.revision_id = r.id
      GROUP BY a.id, r.id
      ORDER BY a.title, a.id, r.revision_number DESC`,
    [],
    executor,
  );
  const albums = new Map<string, ManagedAlbumSummary>();
  for (const row of result.rows) {
    const album = albums.get(row.album_id) ?? {
      id: row.album_id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      revisions: [],
    };
    album.revisions.push({
      id: row.revision_id,
      number: row.revision_number,
      label: row.revision_label,
      status: row.status,
      sectionCount: row.section_count,
      stickerCount: row.sticker_count,
      publishedAt: row.published_at?.toISOString() ?? null,
      archivedAt: row.archived_at?.toISOString() ?? null,
    });
    albums.set(row.album_id, album);
  }
  return [...albums.values()];
}

export async function correctAlbumMetadata(
  albumId: string,
  revisionId: string,
  metadata: { title: string; description: string | null },
  pool: Pool = getPool(),
): Promise<void> {
  await withTransaction(async (client) => {
    const current = await query<{ title: string; description: string | null }>(
      `SELECT a.title, a.description
         FROM albums a
         JOIN album_revisions r ON r.album_id = a.id
        WHERE a.id = $1 AND r.id = $2
        FOR UPDATE OF a`,
      [albumId, revisionId],
      client,
    );
    const album = current.rows[0];
    if (!album) throw new CatalogError("Album revision not found.", 404);
    for (const [field, previous, corrected] of [
      ["title", album.title, metadata.title],
      ["description", album.description, metadata.description],
    ] as const) {
      if (previous === corrected) continue;
      await query(
        `INSERT INTO album_metadata_corrections
           (revision_id, entity_type, entity_id, field_name, previous_value, corrected_value)
         VALUES ($1, 'album', $2, $3, $4, $5)`,
        [revisionId, albumId, field, previous, corrected ?? ""],
        client,
      );
    }
    await query(
      "UPDATE albums SET title = $1, description = $2, updated_at = now() WHERE id = $3",
      [metadata.title, metadata.description, albumId],
      client,
    );
  }, pool);
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

export async function listPublishedAlbums(
  executor?: QueryExecutor,
): Promise<PublishedAlbumSummary[]> {
  const result = await query<{
    id: string;
    slug: string;
    title: string;
    description: string | null;
    revision_id: string;
    revision_number: number;
    sticker_count: number;
  }>(
    `SELECT a.id, a.slug, a.title, a.description, r.id AS revision_id,
            r.revision_number, count(rs.sticker_id)::integer AS sticker_count
       FROM albums a
       JOIN album_revisions r ON r.album_id = a.id AND r.status = 'published'
       JOIN album_revision_stickers rs ON rs.revision_id = r.id
      GROUP BY a.id, r.id
      ORDER BY a.title, a.id`,
    [],
    executor,
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    stickerCount: row.sticker_count,
  }));
}
