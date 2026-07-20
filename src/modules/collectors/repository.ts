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

/**
 * Marks the collector's onboarding as complete. This is server-authoritative and
 * idempotent: the first completion timestamp is preserved on repeat calls, so a
 * later re-submission never rewrites when onboarding was actually finished. A
 * deliberate zero-album completion still records the timestamp.
 */
export async function markCollectorOnboardingComplete(
  collectorId: string,
  executor?: QueryExecutor,
): Promise<void> {
  await query(
    "UPDATE collector_profiles SET onboarding_completed_at = COALESCE(onboarding_completed_at, now()), updated_at = now() WHERE id = $1",
    [collectorId],
    executor,
  );
}
