import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.sql(`
    CREATE TABLE invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL UNIQUE,
      email text NOT NULL,
      display_name text,
      created_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
      accepted_by_user_id uuid REFERENCES "user"(id) ON DELETE SET NULL,
      expires_at timestamptz NOT NULL,
      accepted_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (accepted_by_user_id IS NULL OR accepted_at IS NOT NULL)
    );
    CREATE INDEX invitations_email_idx ON invitations (email);
    CREATE INDEX invitations_pending_idx ON invitations (expires_at)
      WHERE accepted_at IS NULL AND revoked_at IS NULL;
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.sql(`DROP TABLE invitations;`);
}
