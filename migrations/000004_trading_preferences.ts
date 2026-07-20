import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE trading_preferences (
      collector_id uuid PRIMARY KEY REFERENCES collector_profiles(id) ON DELETE CASCADE,
      visible boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    INSERT INTO trading_preferences (collector_id)
    SELECT id FROM collector_profiles;

    CREATE FUNCTION create_default_trading_preferences() RETURNS trigger AS $$
    BEGIN
      INSERT INTO trading_preferences (collector_id) VALUES (NEW.id);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER collector_profiles_default_trading_preferences
      AFTER INSERT ON collector_profiles
      FOR EACH ROW EXECUTE FUNCTION create_default_trading_preferences();

    CREATE INDEX trading_preferences_visible_idx
      ON trading_preferences (collector_id) WHERE visible;
    CREATE INDEX collections_trade_candidates_idx
      ON collections (album_id, collector_id, revision_id) WHERE status = 'active';
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX collections_trade_candidates_idx;
    DROP TRIGGER collector_profiles_default_trading_preferences ON collector_profiles;
    DROP FUNCTION create_default_trading_preferences();
    DROP TABLE trading_preferences;
  `);
}
