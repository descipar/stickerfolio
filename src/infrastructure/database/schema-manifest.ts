/**
 * Migrations this build expects, in order (#132). Compiled into the build so
 * readiness can compare the database with the code that is actually running.
 * `test/schema-manifest.test.ts` keeps this list equal to `migrations/`.
 */
export const expectedMigrations = [
  "000001_initial_identity",
  "000002_catalog_and_collections",
  "000003_identity_roles_and_profiles",
  "000004_trading_preferences",
  "000005_invitations",
  "000006_onboarding_completion",
  "000007_collection_share_links",
  "000008_collection_comparison_grants",
  "000009_active_collector_profiles",
] as const;

export const expectedSchemaVersion: string = expectedMigrations[expectedMigrations.length - 1];
