import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";

import { lockAdministratorsForMutation } from "./administrator-lock";
import { getAuth, type StickerfolioAuth } from "./auth";
import { normalizeEmail } from "./email";
import { verifyPassword } from "./password";
import { requireIdentity } from "./session";

export class AccountLifecycleError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = "AccountLifecycleError";
  }
}

async function verifyOwnPassword(
  userId: string,
  currentPassword: string,
  executor: QueryExecutor,
): Promise<void> {
  const account = await query<{ password: string | null }>(
    `SELECT password FROM account
      WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [userId],
    executor,
  );
  const passwordHash = account.rows[0]?.password;
  if (!passwordHash || !(await verifyPassword({ hash: passwordHash, password: currentPassword }))) {
    throw new AccountLifecycleError("The current password is incorrect.", 401);
  }
}

/**
 * Self-service side of the shared last-active-administrator guard. It delegates
 * to {@link lockAdministratorsForMutation}, which locks every administrator row
 * FOR UPDATE and refuses the removing mutation when the target is an
 * administrator and no OTHER administrator with `status = 'active'` would remain
 * (Roadmap 11.4, risk section 18). Only ACTIVE administrators count: a suspended
 * administrator cannot sign in and therefore cannot reactivate anyone, so the
 * sole active administrator cannot delete or deactivate itself even while a
 * suspended administrator still exists. The restricted bootstrap admin is an
 * ordinary administrator here, so this preserves the "never recreate/reset"
 * property. No `actorUserId` is passed: the actor is the target itself and is
 * identified from the session, so there is no separate stale-authorization actor
 * to revalidate.
 */
async function assertNotLastAdministrator(client: PoolClient, userId: string): Promise<void> {
  await lockAdministratorsForMutation(
    client,
    { targetUserId: userId, removesActiveAdministrator: true },
    {
      lastActiveAdministrator: () =>
        new AccountLifecycleError("The last active administrator account cannot be removed.", 409),
    },
  );
}

/**
 * Self-service deactivation. This is the reversible sibling of an administrator
 * suspension: the account row moves to `status = 'suspended'` and every active
 * session is revoked with the same `DELETE FROM session` pattern used on
 * administrator suspension and password reset. A suspended account cannot sign
 * in (enforced in the Better Auth session-create hook and in resolveIdentity),
 * so reactivation is deliberately an administrator action. The account is
 * identified from the session only, never from a client-supplied id.
 */
export async function deactivateOwnAccount(
  headers: Headers,
  currentPassword: string,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<void> {
  const identity = await requireIdentity(headers, auth, pool);
  await verifyOwnPassword(identity.userId, currentPassword, pool);
  await withTransaction(async (client) => {
    await assertNotLastAdministrator(client, identity.userId);
    await query(
      `UPDATE "user" SET status = 'suspended', "updatedAt" = now() WHERE id = $1`,
      [identity.userId],
      client,
    );
    await query(`DELETE FROM session WHERE "userId" = $1`, [identity.userId], client);
  }, pool);
  // Security-sensitive action audit. Only the acting/target user id is recorded;
  // the email address and any holdings are intentionally never logged.
  writeAuditEvent(
    "account.deactivated",
    { type: "user", userId: identity.userId },
    { type: "user", id: identity.userId },
  );
}

/**
 * Self-service permanent deletion. Irreversible, so it requires deliberate
 * confirmation: the caller re-enters the current password and types the exact
 * login email. Both are verified server-side; hiding a UI control is not a
 * guard. Deletion runs as one transaction and relies on the ON DELETE CASCADE
 * foreign keys (session, account, collector_profiles -> collections ->
 * holdings, trading_preferences) so the whole owned graph is removed, no other
 * user's rows are touched, and no foreign key is violated. Shared catalog rows
 * are referenced ON DELETE RESTRICT, which blocks deleting catalog data, not
 * the user's own collection rows.
 *
 * Data export: users should export their data first (Roadmap 10.3). The account
 * danger zone surfaces an explicit "export first" step, and the complete,
 * portable account-data export is tracked in issue #88. The per-collection CSV
 * export (#68) only produces missing/duplicate lists and is deliberately not a
 * full export, so it is not treated as one here. Deletion is intentionally
 * standalone and never blocks on export.
 *
 * Invitations: invitation-based registration (#87) is merged, so
 * `invitations.created_by_user_id` is NULLABLE with ON DELETE SET NULL.
 * Deleting a user therefore does NOT cascade-delete the invitations they
 * created: their pending invitations survive with the creator cleared to NULL,
 * and accepted-invitation records keep their acceptor. The combined
 * deletion-with-pending/accepted-invitations behaviour is covered by the
 * account-lifecycle integration tests.
 */
export async function deleteOwnAccount(
  headers: Headers,
  currentPassword: string,
  confirmationEmail: string,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<void> {
  const identity = await requireIdentity(headers, auth, pool);
  await verifyOwnPassword(identity.userId, currentPassword, pool);
  await withTransaction(async (client) => {
    await assertNotLastAdministrator(client, identity.userId);
    const target = await query<{ email: string }>(
      `SELECT email FROM "user" WHERE id = $1 FOR UPDATE`,
      [identity.userId],
      client,
    );
    const email = target.rows[0]?.email;
    if (!email) throw new AccountLifecycleError("Account not found.", 401);
    if (normalizeEmail(confirmationEmail) !== email) {
      throw new AccountLifecycleError("Type your exact account email to confirm deletion.");
    }
    const deletion = await query(`DELETE FROM "user" WHERE id = $1`, [identity.userId], client);
    if (deletion.rowCount !== 1) throw new AccountLifecycleError("Account not found.", 401);
  }, pool);
  writeAuditEvent(
    "account.deleted",
    { type: "user", userId: identity.userId },
    { type: "user", id: identity.userId },
    { actor: "self" },
  );
}
