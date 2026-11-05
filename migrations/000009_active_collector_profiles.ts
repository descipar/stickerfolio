import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

// One shared definition of a collector that other users may see: the profile
// belongs to an existing, active account. Suspended or self-deactivated
// accounts (status 'suspended') and profiles without an account disappear from
// trade matching, public share links, and direct comparisons, and reappear on
// reactivation without changing stored preferences, links, or grants (#123).
export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE VIEW active_collector_profiles AS
      SELECT profile.id
        FROM collector_profiles profile
        JOIN "user" account ON account.id = profile.user_id
       WHERE account.status = 'active';
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP VIEW active_collector_profiles;`);
}
