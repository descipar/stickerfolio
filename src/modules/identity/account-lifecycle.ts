import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction, type QueryExecutor } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";

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
 * Guards the roadmap guarantee that at least one administrator always exists
 * (Roadmap 11.4, risk section 18). All administrator rows are locked FOR UPDATE
 * so two concurrent lifecycle changes cannot both slip past the check and leave
 * the installation with no administrator. The restricted bootstrap admin is an
 * ordinary administrator here, so this also prevents removing it while it is the
 * only one, preserving the "never recreate/reset" property.
 */
async function assertNotLastAdministrator(client: PoolClient, userId: string): Promise<void> {
  const admins = await query<{ id: string }>(
    `SELECT id FROM "user" WHERE role = 'admin' FOR UPDATE`,
    [],
    client,
  );
  const adminIds = admins.rows.map((row) => row.id);
  if (adminIds.includes(userId) && adminIds.length <= 1) {
    throw new AccountLifecycleError("The last administrator account cannot be removed.", 409);
  }
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
 * Data export: users should export their collections first (Roadmap 10.3). The
 * CSV export (issue #68) is surfaced as an explicit "export first" step in the
 * UI; deletion is intentionally standalone and never blocks on it.
 *
 * NOTE: once invitation-based registration lands, its
 * `invitations.created_by_user_id` / `accepted_by_user_id` references must use
 * ON DELETE SET NULL (or be cleared in this transaction) so deletion keeps
 * cascading cleanly.
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
