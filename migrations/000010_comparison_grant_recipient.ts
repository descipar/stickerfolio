import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

// #133: a direct-comparison grant is bound to the first collector who redeems
// it. Afterwards only that collector (and the owner, for revocation) can use it.
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    ALTER TABLE collection_comparison_grants
      ADD COLUMN recipient_collector_id uuid REFERENCES collector_profiles(id) ON DELETE CASCADE,
      ADD COLUMN redeemed_at timestamptz,
      ADD CONSTRAINT collection_comparison_grants_redemption_check
        CHECK ((recipient_collector_id IS NULL) = (redeemed_at IS NULL));

    CREATE INDEX collection_comparison_grants_recipient_idx
      ON collection_comparison_grants (recipient_collector_id)
      WHERE recipient_collector_id IS NOT NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`
    DROP INDEX collection_comparison_grants_recipient_idx;
    ALTER TABLE collection_comparison_grants
      DROP CONSTRAINT collection_comparison_grants_redemption_check,
      DROP COLUMN redeemed_at,
      DROP COLUMN recipient_collector_id;
  `);
}
