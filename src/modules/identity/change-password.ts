import type { Pool } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";
import { writeAuditEvent } from "@/infrastructure/observability";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

import { getAuth, type StickerfolioAuth } from "./auth";
import { hashPassword, verifyPassword } from "./password";
import { requireIdentitySession } from "./session";

export class PasswordChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordChangeError";
  }
}

/**
 * Self-service password change (#128). Runs in one transaction: verifies the
 * current password, stores the new hash, clears `mustChangePassword`, and
 * revokes every other session of the account. The caller's own session stays
 * valid. This is the only password-change entry point; Better Auth's
 * `/change-password` endpoint is not exposed over HTTP.
 */
export async function changeOwnPassword(
  headers: Headers,
  currentPassword: string,
  newPassword: string,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<void> {
  const { identity, sessionId } = await requireIdentitySession(headers, auth, pool);
  if (newPassword.length < minimumPasswordLength || newPassword.length > maximumPasswordLength) {
    throw new PasswordChangeError("The new password does not meet the requirements.");
  }

  const revokedSessions = await withTransaction(async (client) => {
    const account = await query<{ password: string | null }>(
      `SELECT account.password
         FROM account
         JOIN "user" ON "user".id = account."userId"
        WHERE account."userId" = $1 AND account."providerId" = 'credential'
          AND "user".status = 'active'
        FOR UPDATE OF account, "user"`,
      [identity.userId],
      client,
    );
    const currentHash = account.rows[0]?.password;
    if (!currentHash || !(await verifyPassword({ hash: currentHash, password: currentPassword }))) {
      throw new PasswordChangeError("The current password is incorrect.");
    }

    await query(
      `UPDATE account SET password = $1, "updatedAt" = now()
        WHERE "userId" = $2 AND "providerId" = 'credential'`,
      [await hashPassword(newPassword), identity.userId],
      client,
    );
    await query(
      `UPDATE "user" SET "mustChangePassword" = false, "updatedAt" = now() WHERE id = $1`,
      [identity.userId],
      client,
    );
    const revoked = await query(
      `DELETE FROM session WHERE "userId" = $1 AND id <> $2`,
      [identity.userId, sessionId],
      client,
    );
    return revoked.rowCount ?? 0;
  }, pool);

  writeAuditEvent(
    "account.password_changed",
    { type: "user", userId: identity.userId },
    { type: "user", id: identity.userId },
    { revokedOtherSessions: revokedSessions },
  );
}
