import type { PoolClient } from "pg";

import { query } from "@/infrastructure/database";

export interface AdministratorGuardErrors {
  /** Thrown when the mutation would leave zero active administrators. */
  lastActiveAdministrator: () => Error;
  /**
   * Thrown when the acting administrator is no longer a valid active
   * administrator. Only consulted when `actorUserId` is provided.
   */
  actorNoLongerAdministrator?: () => Error;
}

export interface AdministratorLockOptions {
  /**
   * The user being deleted, suspended, reactivated, or having their role
   * changed.
   */
  targetUserId: string;
  /**
   * The acting administrator for administrator-panel operations. When set, the
   * actor is revalidated as a still-existing, active administrator after the
   * lock is acquired: `requireAdmin` ran at the HTTP layer and may be stale
   * because a concurrent mutation could have deleted, suspended, or demoted the
   * actor while this request waited on the lock. Omit for self-service actions,
   * where the actor is the target and is identified from the session.
   */
  actorUserId?: string;
  /**
   * Whether the mutation removes the target from the set of active
   * administrators (deletion, suspension, demotion). When true, the invariant
   * that at least one OTHER active administrator remains afterwards is enforced.
   * Set false for reactivation and promotion, which only add administrator
   * capacity and can never leave the installation without an active admin.
   */
  removesActiveAdministrator: boolean;
}

/**
 * Shared last-active-administrator locking protocol used by every administrator
 * lifecycle, status, and role mutation (admin-panel deletion, self-service
 * deactivation and deletion, suspension/reactivation, and role changes). Callers
 * run this inside their `withTransaction` block BEFORE checking business rules
 * and mutating.
 *
 * It performs, in order:
 *  1. Locks every administrator row with `SELECT ... WHERE role = 'admin' FOR
 *     UPDATE`. This single lock serializes all concurrent administrator
 *     mutations so two of them can no longer interleave their check and mutation
 *     phases and jointly leave the installation without an active administrator.
 *  2. (admin-panel actors only) Revalidates the acting administrator against the
 *     freshly locked snapshot: the actor must still exist and still be an
 *     ACTIVE administrator. This closes the race where an already-authorized
 *     request (its HTTP `requireAdmin` long since passed, and its session may
 *     already be revoked) resumes after a concurrent mutation deleted, suspended,
 *     or demoted the actor.
 *  3. Enforces the invariant for removing mutations: if the target is (still) an
 *     administrator, at least one OTHER administrator with `status = 'active'`
 *     must remain. A suspended administrator never counts as a usable fallback,
 *     because it cannot sign in to reactivate anyone. This preserves the
 *     guarantee that the bootstrap administrator is never left un-recreatable
 *     (Roadmap 11.4 / 18).
 */
export async function lockAdministratorsForMutation(
  client: PoolClient,
  options: AdministratorLockOptions,
  errors: AdministratorGuardErrors,
): Promise<void> {
  const admins = await query<{ id: string; status: string }>(
    `SELECT id, status FROM "user" WHERE role = 'admin' FOR UPDATE`,
    [],
    client,
  );

  if (options.actorUserId !== undefined) {
    const actor = admins.rows.find((row) => row.id === options.actorUserId);
    if (!actor || actor.status !== "active") {
      const make = errors.actorNoLongerAdministrator ?? errors.lastActiveAdministrator;
      throw make();
    }
  }

  if (!options.removesActiveAdministrator) return;

  const targetIsAdmin = admins.rows.some((row) => row.id === options.targetUserId);
  const otherActiveAdmins = admins.rows.filter(
    (row) => row.id !== options.targetUserId && row.status === "active",
  );
  if (targetIsAdmin && otherActiveAdmins.length === 0) {
    throw errors.lastActiveAdministrator();
  }
}
