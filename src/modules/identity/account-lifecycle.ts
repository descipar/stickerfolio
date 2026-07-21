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
 * Guards the roadmap guarantee that at least one administrator who can actually
 * sign in always exists (Roadmap 11.4, risk section 18). All administrator rows
 * are locked FOR UPDATE so two concurrent lifecycle changes cannot both slip
 * past the check and leave the installation without a usable administrator.
 *
 * Only ACTIVE administrators count: a suspended administrator cannot sign in and
 * therefore cannot reactivate anyone. The action is refused when the target is
 * an administrator and no OTHER administrator with `status = 'active'` would
 * remain afterwards. This stops the sole active administrator from deleting or
 * deactivating itself even while a suspended administrator still exists — which
 * would otherwise leave nobody able to sign in and reactivate that suspended
 * one. The restricted bootstrap admin is an ordinary administrator here, so this
 * also preserves the "never recreate/reset" property.
 */
async function assertNotLastAdministrator(client: PoolClient, userId: string): Promise<void> {
  const admins = await query<{ id: string; status: string }>(
    `SELECT id, status FROM "user" WHERE role = 'admin' FOR UPDATE`,
    [],
    client,
  );
  const targetIsAdmin = admins.rows.some((row) => row.id === userId);
  const otherActiveAdmins = admins.rows.filter(
    (row) => row.id !== userId && row.status === "active",
  );
  if (targetIsAdmin && otherActiveAdmins.length === 0) {
    throw new AccountLifecycleError("The last active administrator account cannot be removed.", 409);
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
 * Data export: users should export their data first (Roadmap 10.3). The account
 * danger zone surfaces an explicit "export first" step, and the complete,
 * portable account-data export is tracked in issue #88. The per-collection CSV
 * export (#68) only produces missing/duplicate lists and is deliberately not a
 * full export, so it is not treated as one here. Deletion is intentionally
 * standalone and never blocks on export.
 *
 * NOTE: invitation-based registration is not on this branch (M1, #87). The
 * agreed data policy is that `invitations.created_by_user_id` becomes NULLABLE
 * with ON DELETE SET NULL in #87, so deleting an administrator does NOT
 * cascade-delete their pending invitations and accepted-invitation records
 * survive. The combined deletion-with-pending/accepted-invitations integration
 * test will be added once M1 (#87) merges.
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
