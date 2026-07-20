import { query, type QueryExecutor } from "@/infrastructure/database";

/**
 * Updates the visible collector display name. The display name is never a login
 * identity; the login email lives on the Better Auth user record. Used by
 * onboarding to let a collector confirm or change the name generated at
 * registration.
 */
export async function updateCollectorDisplayName(
  collectorId: string,
  displayName: string,
  executor?: QueryExecutor,
): Promise<void> {
  await query(
    "UPDATE collector_profiles SET display_name = $1, updated_at = now() WHERE id = $2",
    [displayName, collectorId],
    executor,
  );
}
