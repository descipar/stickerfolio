import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE albums (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug text NOT NULL UNIQUE,
      title text NOT NULL,
      description text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE album_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      revision_number integer NOT NULL CHECK (revision_number > 0),
      label text NOT NULL,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
      published_at timestamptz,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (album_id, revision_number),
      UNIQUE (album_id, id)
    );
    CREATE UNIQUE INDEX album_revisions_one_published
      ON album_revisions (album_id) WHERE status = 'published';

    CREATE TABLE stickers (
      id uuid PRIMARY KEY,
      album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      stable_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (album_id, stable_key),
      UNIQUE (album_id, id)
    );

    CREATE TABLE album_sections (
      id uuid PRIMARY KEY,
      album_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      code text NOT NULL,
      name text NOT NULL,
      sort_order integer NOT NULL CHECK (sort_order >= 0),
      FOREIGN KEY (album_id, revision_id)
        REFERENCES album_revisions(album_id, id) ON DELETE CASCADE,
      UNIQUE (revision_id, code),
      UNIQUE (revision_id, sort_order),
      UNIQUE (album_id, revision_id, id)
    );

    CREATE TABLE album_revision_stickers (
      album_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      sticker_id uuid NOT NULL,
      section_id uuid NOT NULL,
      code text NOT NULL,
      label text NOT NULL,
      sort_order integer NOT NULL CHECK (sort_order >= 0),
      PRIMARY KEY (revision_id, sticker_id),
      FOREIGN KEY (album_id, revision_id)
        REFERENCES album_revisions(album_id, id) ON DELETE CASCADE,
      FOREIGN KEY (album_id, sticker_id)
        REFERENCES stickers(album_id, id) ON DELETE RESTRICT,
      FOREIGN KEY (album_id, revision_id, section_id)
        REFERENCES album_sections(album_id, revision_id, id) ON DELETE RESTRICT,
      UNIQUE (revision_id, code),
      UNIQUE (revision_id, sort_order),
      UNIQUE (album_id, revision_id, sticker_id)
    );
    CREATE INDEX album_revision_stickers_section_idx
      ON album_revision_stickers (revision_id, section_id, sort_order);

    CREATE TABLE album_metadata_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      revision_id uuid NOT NULL REFERENCES album_revisions(id) ON DELETE CASCADE,
      entity_type text NOT NULL CHECK (entity_type IN ('album', 'section', 'sticker')),
      entity_id uuid,
      field_name text NOT NULL,
      previous_value text,
      corrected_value text NOT NULL,
      corrected_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE collector_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE collections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      collector_id uuid NOT NULL REFERENCES collector_profiles(id) ON DELETE CASCADE,
      album_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (album_id, revision_id)
        REFERENCES album_revisions(album_id, id) ON DELETE RESTRICT,
      UNIQUE (id, album_id, revision_id)
    );
    CREATE UNIQUE INDEX collections_one_active_album
      ON collections (collector_id, album_id) WHERE status = 'active';
    CREATE INDEX collections_collector_idx ON collections (collector_id, created_at);

    CREATE TABLE holdings (
      collection_id uuid NOT NULL,
      album_id uuid NOT NULL,
      revision_id uuid NOT NULL,
      sticker_id uuid NOT NULL,
      quantity smallint NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_id, sticker_id),
      FOREIGN KEY (collection_id, album_id, revision_id)
        REFERENCES collections(id, album_id, revision_id) ON DELETE CASCADE,
      FOREIGN KEY (album_id, revision_id, sticker_id)
        REFERENCES album_revision_stickers(album_id, revision_id, sticker_id) ON DELETE RESTRICT
    );
    CREATE INDEX holdings_sticker_quantity_idx ON holdings (sticker_id, quantity);

    CREATE FUNCTION assert_draft_album_structure() RETURNS trigger AS $$
    DECLARE
      target_revision uuid;
    BEGIN
      target_revision := CASE WHEN TG_OP = 'DELETE' THEN OLD.revision_id ELSE NEW.revision_id END;
      IF NOT EXISTS (
        SELECT 1 FROM album_revisions WHERE id = target_revision AND status = 'draft'
      ) THEN
        RAISE EXCEPTION 'Album structure can be changed only on a draft revision';
      END IF;
      RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER album_sections_require_draft
      BEFORE INSERT OR UPDATE OR DELETE ON album_sections
      FOR EACH ROW EXECUTE FUNCTION assert_draft_album_structure();
    CREATE TRIGGER album_revision_stickers_require_draft
      BEFORE INSERT OR UPDATE OR DELETE ON album_revision_stickers
      FOR EACH ROW EXECUTE FUNCTION assert_draft_album_structure();

    CREATE FUNCTION enforce_album_revision_lifecycle() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
          RAISE EXCEPTION 'Published or archived revisions cannot be deleted';
        END IF;
        RETURN OLD;
      END IF;

      IF OLD.album_id <> NEW.album_id OR OLD.revision_number <> NEW.revision_number THEN
        RAISE EXCEPTION 'Revision identity cannot be changed';
      END IF;

      IF OLD.status <> NEW.status THEN
        IF NOT ((OLD.status = 'draft' AND NEW.status = 'published') OR
                (OLD.status = 'published' AND NEW.status = 'archived')) THEN
          RAISE EXCEPTION 'Invalid album revision status transition';
        END IF;

        IF NEW.status = 'published' THEN
          IF NOT EXISTS (SELECT 1 FROM album_sections WHERE revision_id = NEW.id) OR
             NOT EXISTS (SELECT 1 FROM album_revision_stickers WHERE revision_id = NEW.id) THEN
            RAISE EXCEPTION 'A revision must contain sections and stickers before publication';
          END IF;
          NEW.published_at := COALESCE(NEW.published_at, now());
        ELSIF NEW.status = 'archived' THEN
          NEW.archived_at := COALESCE(NEW.archived_at, now());
        END IF;
      END IF;

      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER album_revision_lifecycle
      BEFORE UPDATE OR DELETE ON album_revisions
      FOR EACH ROW EXECUTE FUNCTION enforce_album_revision_lifecycle();

    CREATE FUNCTION enforce_new_collection_revision() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'INSERT' AND NOT EXISTS (
        SELECT 1 FROM album_revisions
        WHERE id = NEW.revision_id AND album_id = NEW.album_id AND status = 'published'
      ) THEN
        RAISE EXCEPTION 'New collections must use a published revision';
      END IF;
      IF TG_OP = 'UPDATE' AND
         (OLD.album_id <> NEW.album_id OR OLD.revision_id <> NEW.revision_id OR OLD.collector_id <> NEW.collector_id) THEN
        RAISE EXCEPTION 'Collection identity and revision cannot be changed';
      END IF;
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER collections_revision_guard
      BEFORE INSERT OR UPDATE ON collections
      FOR EACH ROW EXECUTE FUNCTION enforce_new_collection_revision();
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP TABLE holdings;
    DROP TABLE collections;
    DROP TABLE collector_profiles;
    DROP TABLE album_metadata_corrections;
    DROP TABLE album_revision_stickers;
    DROP TABLE album_sections;
    DROP TABLE stickers;
    DROP TABLE album_revisions;
    DROP TABLE albums;
    DROP FUNCTION enforce_new_collection_revision();
    DROP FUNCTION enforce_album_revision_lifecycle();
    DROP FUNCTION assert_draft_album_structure();
  `);
}
