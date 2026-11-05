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

export interface CollectorProfile {
  id: string;
  displayName: string;
  onboardingCompleted: boolean;
}

/** The collector profile that belongs to an account, if any. */
export async function getCollectorProfileForUser(
  userId: string,
  executor?: QueryExecutor,
): Promise<CollectorProfile | null> {
  const result = await query<{ id: string; display_name: string; onboarding_completed_at: Date | null }>(
    "SELECT id, display_name, onboarding_completed_at FROM collector_profiles WHERE user_id = $1",
    [userId],
    executor,
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, displayName: row.display_name, onboardingCompleted: row.onboarding_completed_at !== null }
    : null;
}

/** Creates the collector profile of a newly created account, inside the caller's transaction. */
export async function createCollectorProfileForUser(
  userId: string,
  displayName: string,
  executor?: QueryExecutor,
): Promise<{ id: string; displayName: string }> {
  const result = await query<{ id: string; display_name: string }>(
    `INSERT INTO collector_profiles (user_id, display_name)
     VALUES ($1, $2) RETURNING id, display_name`,
    [userId, displayName],
    executor,
  );
  return { id: result.rows[0]!.id, displayName: result.rows[0]!.display_name };
}

/** Creates a collector profile without an account (seeds and tests). */
export async function createCollectorProfile(
  displayName: string,
  executor?: QueryExecutor,
): Promise<{ id: string; displayName: string }> {
  const result = await query<{ id: string; display_name: string }>(
    "INSERT INTO collector_profiles (display_name) VALUES ($1) RETURNING id, display_name",
    [displayName],
    executor,
  );
  return { id: result.rows[0]!.id, displayName: result.rows[0]!.display_name };
}

/** The collectors module's part of the portable account export (#125). */
export interface CollectorProfileExport {
  id: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
  onboardingCompletedAt: string | null;
}

export async function exportCollectorProfile(
  userId: string,
  executor?: QueryExecutor,
): Promise<CollectorProfileExport | null> {
  const result = await query<{
    id: string;
    display_name: string;
    created_at: Date;
    updated_at: Date;
    onboarding_completed_at: Date | null;
  }>(
    `SELECT id, display_name, created_at, updated_at, onboarding_completed_at
       FROM collector_profiles WHERE user_id = $1`,
    [userId],
    executor,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    onboardingCompletedAt: row.onboarding_completed_at?.toISOString() ?? null,
  };
}
