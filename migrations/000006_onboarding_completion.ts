import type { MigrationBuilder } from "node-pg-migrate";

export const shorthands = undefined;

export function up(pgm: MigrationBuilder): void {
  // Persisted, server-authoritative onboarding-completion marker. NULL means the
  // collector has not finished onboarding yet; a timestamp records the moment
  // onboarding was completed (including a deliberate zero-album completion).
  pgm.addColumn("collector_profiles", {
    onboarding_completed_at: { type: "timestamptz" },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn("collector_profiles", "onboarding_completed_at");
}
