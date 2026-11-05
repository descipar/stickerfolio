import type { Pool, PoolClient } from "pg";

import { DatabaseError, getPool, query, withTransaction } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import { createCollectorProfileForUser } from "@/modules/collectors";
import {
  deleteAccount,
  hashPassword,
  insertCredentialAccount,
  lockAccountEmail,
  lockAdministratorsForMutation,
  normalizeEmail,
  revokeAllSessions,
  setAccountEmail,
  setAccountPassword,
  setAccountRole,
  setAccountStatus,
  verifyAccountPassword,
  type UserRole,
} from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";
import { type Principal, requirePrincipal } from "@/shared/principal";

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

export type UserStatus = "active" | "suspended";

export interface ManagedUser {
  id: string;
  email: string;
  accountName: string;
  displayName: string | null;
  role: UserRole;
  status: UserStatus;
  mustChangePassword: boolean;
  createdAt: string;
}

export function requireAdmin(principal: Principal | null): Principal {
  const resolved = requirePrincipal(principal);
  if (resolved.mustChangePassword || resolved.role !== "admin") {
    throw new AdminError("Administrator access required.", 403);
  }
  return resolved;
}

export async function listManagedUsers(
  principal: Principal | null,
  pool: Pool = getPool(),
): Promise<ManagedUser[]> {
  requireAdmin(principal);
  const result = await query<{
    id: string;
    email: string;
    account_name: string;
    display_name: string | null;
    role: UserRole;
    status: UserStatus;
    must_change_password: boolean;
    created_at: Date;
  }>(
    `SELECT u.id, u.email, u.name AS account_name, cp.display_name, u.role, u.status,
            u."mustChangePassword" AS must_change_password, u."createdAt" AS created_at
       FROM "user" u
       LEFT JOIN collector_profiles cp ON cp.user_id = u.id
      ORDER BY u."createdAt", u.id`,
    [],
    pool,
  );
  return result.rows.map((row) => ({
    id: row.id,
    email: row.email,
    accountName: row.account_name,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function changeOwnAdminEmail(
  principal: Principal | null,
  email: string,
  currentPassword: string,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  if (!(await verifyAccountPassword(actor.userId, currentPassword, pool))) {
    throw new AdminError("The current password is incorrect.");
  }
  try {
    await setAccountEmail(actor.userId, email, pool);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new AdminError("The email address is already in use.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new AdminError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }
  writeAuditEvent(
    "account.email_changed",
    { type: "user", userId: actor.userId },
    { type: "user", id: actor.userId },
    { sessionsRevoked: false },
  );
}

/**
 * Administrator changes any user's login email. Normalizes with the shared
 * identity normalization, relies on the unique constraint for an atomic
 * check-and-set (23505 -> 409), and revokes the target user's sessions so they
 * must sign in again with the new address (product decision). Email
 * verification is intentionally disabled in the MVP (Roadmap 8.3), so the new
 * address is effective immediately.
 */
export async function setManagedUserEmail(
  principal: Principal | null,
  userId: string,
  email: string,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  try {
    await withTransaction(async (client) => {
      if (!(await setAccountEmail(userId, email, client))) throw new AdminError("User not found.", 404);
      await revokeAllSessions(userId, client);
    }, pool);
  } catch (error) {
    if (error instanceof AdminError) throw error;
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new AdminError("The email address is already in use.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new AdminError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }
  writeAuditEvent(
    "account.email_changed",
    { type: "user", userId: actor.userId },
    { type: "user", id: userId },
    { sessionsRevoked: true },
  );
}

interface CreateManagedUserInput {
  email: string;
  displayName: string;
  initialPassword: string;
  role: UserRole;
}

async function insertManagedUser(
  client: PoolClient,
  input: CreateManagedUserInput,
  passwordHash: string,
): Promise<string> {
  const userId = await insertCredentialAccount(
    {
      email: input.email,
      name: input.displayName,
      passwordHash,
      role: input.role,
      mustChangePassword: true,
    },
    client,
  );
  await createCollectorProfileForUser(userId, input.displayName, client);
  return userId;
}

export async function createManagedUser(
  principal: Principal | null,
  input: CreateManagedUserInput,
  pool: Pool = getPool(),
): Promise<{ id: string }> {
  const actor = requireAdmin(principal);
  if (input.initialPassword.length < minimumPasswordLength || input.initialPassword.length > maximumPasswordLength) {
    throw new AdminError(`Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`);
  }
  const passwordHash = await hashPassword(input.initialPassword);
  try {
    const id = await withTransaction((client) => insertManagedUser(client, input, passwordHash), pool);
    writeAuditEvent(
      "account.created",
      { type: "user", userId: actor.userId },
      { type: "user", id },
      { role: input.role },
    );
    return { id };
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      throw new AdminError("The email address is already in use.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new AdminError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }
}

export async function resetManagedUserPassword(
  principal: Principal | null,
  userId: string,
  newPassword: string,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  if (actor.userId === userId) throw new AdminError("Use the account password page for your own password.");
  if (newPassword.length < minimumPasswordLength || newPassword.length > maximumPasswordLength) {
    throw new AdminError(`Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`);
  }
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    if (!(await setAccountPassword(userId, passwordHash, true, client))) {
      throw new AdminError("User not found.", 404);
    }
    await revokeAllSessions(userId, client);
  }, pool);
  writeAuditEvent(
    "account.password_reset",
    { type: "user", userId: actor.userId },
    { type: "user", id: userId },
  );
}

/**
 * Administrator suspends or reactivates a user. Suspension of an administrator
 * joins the shared last-active-administrator locking protocol
 * ({@link lockAdministratorsForMutation}): it locks the administrator rows,
 * revalidates the acting administrator, and refuses to suspend the last active
 * administrator, so it cannot race deletion or role changes into leaving zero
 * active administrators. Reactivation only adds capacity, so it locks and
 * revalidates the actor but does not enforce the invariant.
 */
export async function setManagedUserStatus(
  principal: Principal | null,
  userId: string,
  status: UserStatus,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  if (actor.userId === userId && status === "suspended") {
    throw new AdminError("Administrators cannot suspend their own account.");
  }
  await withTransaction(async (client) => {
    await lockAdministratorsForMutation(
      client,
      {
        targetUserId: userId,
        actorUserId: actor.userId,
        removesActiveAdministrator: status === "suspended",
      },
      {
        lastActiveAdministrator: () =>
          new AdminError("The last active administrator account cannot be suspended.", 409),
        actorNoLongerAdministrator: () => new AdminError("Administrator access required.", 403),
      },
    );
    if (!(await setAccountStatus(userId, status, client))) throw new AdminError("User not found.", 404);
    if (status === "suspended") await revokeAllSessions(userId, client);
  }, pool);
  writeAuditEvent(
    "account.status_changed",
    { type: "user", userId: actor.userId },
    { type: "user", id: userId },
    { status },
  );
}

/**
 * Administrator changes a user's role. Demotion of an administrator joins the
 * shared last-active-administrator locking protocol
 * ({@link lockAdministratorsForMutation}) inside a transaction: it locks the
 * administrator rows, revalidates the acting administrator, and refuses to demote
 * the last active administrator, closing the race with concurrent deletion or
 * suspension. Promotion only adds capacity, so it locks and revalidates the
 * actor without enforcing the invariant.
 */
export async function setManagedUserRole(
  principal: Principal | null,
  userId: string,
  role: UserRole,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  if (actor.userId === userId && role !== "admin") {
    throw new AdminError("Administrators cannot remove their own administrator role.");
  }
  await withTransaction(async (client) => {
    await lockAdministratorsForMutation(
      client,
      {
        targetUserId: userId,
        actorUserId: actor.userId,
        removesActiveAdministrator: role !== "admin",
      },
      {
        lastActiveAdministrator: () =>
          new AdminError("The last active administrator account cannot be demoted.", 409),
        actorNoLongerAdministrator: () => new AdminError("Administrator access required.", 403),
      },
    );
    if (!(await setAccountRole(userId, role, client))) throw new AdminError("User not found.", 404);
  }, pool);
  writeAuditEvent(
    "account.role_changed",
    { type: "user", userId: actor.userId },
    { type: "user", id: userId },
    { role },
  );
}

/**
 * Administrator permanently deletes a user account. Irreversible, so it
 * requires deliberate confirmation: the administrator must type the target's
 * exact login email, verified server-side after shared normalization.
 *
 * Safety properties:
 *  - Runs as one transaction and relies on the ON DELETE CASCADE foreign keys
 *    (session, account, collector_profiles -> collections -> holdings,
 *    trading_preferences) so the target user's whole owned graph is removed,
 *    no other user's rows are affected, and no foreign key is violated. Shared
 *    catalog rows are referenced ON DELETE RESTRICT, which blocks deleting
 *    catalog data, not the user's collection rows.
 *  - Guards the last active administrator through the shared locking protocol
 *    (lockAdministratorsForMutation): all administrator rows are locked
 *    FOR UPDATE, the acting administrator is revalidated as a still-active
 *    administrator, and deletion is refused if the target is an administrator
 *    and no OTHER administrator with status = 'active' would remain. Only active
 *    administrators count because a suspended administrator cannot sign in to
 *    reactivate anyone, so the sole active administrator cannot be deleted even
 *    when a suspended administrator still exists. Sharing the lock with
 *    suspension and role changes prevents concurrent mutations from together
 *    leaving zero active administrators, preserving the roadmap guarantee that
 *    the bootstrap admin is never left un-recreatable (Roadmap 11.4 / 18).
 *  - Administrators delete their own account from account settings, never from
 *    the management panel, mirroring the existing self-action guards.
 *
 * Administrators never gain access to holdings here: no collection or holding
 * data is read or returned; only the account.deleted audit event (ids only) is
 * emitted. Users should export their data first (Roadmap 10.3); the account
 * danger zone surfaces an "export first" step and provides the complete,
 * portable account-data export. The per-collection CSV export in #68 remains a
 * focused missing/duplicate list rather than a full export. Deletion never
 * blocks on export.
 *
 * Invitations: invitation-based registration (#87) is merged, so
 * `invitations.created_by_user_id` is NULLABLE with ON DELETE SET NULL.
 * Deleting an administrator therefore does NOT cascade-delete the invitations
 * they created: pending invitations survive with the creator cleared to NULL,
 * and accepted-invitation records keep their acceptor. The combined
 * deletion-with-pending/accepted-invitations behaviour is covered by the
 * account-lifecycle integration tests.
 */
export async function deleteManagedUser(
  principal: Principal | null,
  userId: string,
  confirmationEmail: string,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = requireAdmin(principal);
  if (actor.userId === userId) {
    throw new AdminError("Use your account settings to delete your own account.");
  }
  await withTransaction(async (client) => {
    await lockAdministratorsForMutation(
      client,
      { targetUserId: userId, actorUserId: actor.userId, removesActiveAdministrator: true },
      {
        lastActiveAdministrator: () =>
          new AdminError("The last active administrator account cannot be deleted.", 409),
        actorNoLongerAdministrator: () => new AdminError("Administrator access required.", 403),
      },
    );
    const targetEmail = await lockAccountEmail(userId, client);
    if (!targetEmail) throw new AdminError("User not found.", 404);
    if (normalizeEmail(confirmationEmail) !== targetEmail) {
      throw new AdminError("Type the exact account email to confirm deletion.");
    }
    if (!(await deleteAccount(userId, client))) throw new AdminError("User not found.", 404);
  }, pool);
  writeAuditEvent(
    "account.deleted",
    { type: "user", userId: actor.userId },
    { type: "user", id: userId },
    { actor: "admin" },
  );
}
