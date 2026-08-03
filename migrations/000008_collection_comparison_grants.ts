import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE collection_comparison_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      token_hash text NOT NULL UNIQUE,
      code_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX collection_comparison_grants_collection_idx
      ON collection_comparison_grants (collection_id, created_at DESC);
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable("collection_comparison_grants");
}
