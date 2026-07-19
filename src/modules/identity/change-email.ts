import type { Pool } from "pg";

import { DatabaseError, getPool, query, withTransaction } from "@/infrastructure/database";
import { writeLog } from "@/infrastructure/observability";

import { getAuth, type StickerfolioAuth } from "./auth";
import { normalizeEmail } from "./email";
import { verifyPassword } from "./password";
import { requireIdentity } from "./session";

export class EmailChangeError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 409 | 503 = 400,
  ) {
    super(message);
    this.name = "EmailChangeError";
  }
}

/**
 * Self-service login-email change for the authenticated user (own account only).
 * The account row is identified from the session, never from a client-supplied
 * id, so a user can never change another account's email.
 */
export async function changeOwnEmail(
  headers: Headers,
  newEmail: string,
  currentPassword: string,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<void> {
  const identity = await requireIdentity(headers, auth, pool);

  const account = await query<{ password: string | null }>(
    `SELECT password FROM account
      WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [identity.userId],
    pool,
  );
  const passwordHash = account.rows[0]?.password;
  if (!passwordHash || !(await verifyPassword({ hash: passwordHash, password: currentPassword }))) {
    throw new EmailChangeError("The current password is incorrect.");
  }

  const email = normalizeEmail(newEmail);
  try {
    await withTransaction(async (client) => {
      // The login email is owned by the Better Auth "user" record, which the
      // codebase mutates with direct SQL (see bootstrap and admin user
      // management). Uniqueness is enforced by the unique constraint on
      // "user".email: we attempt the write and translate a unique violation,
      // rather than reading first, so concurrent changes cannot both claim the
      // same address. Email verification is deliberately disabled in the MVP
      // (Roadmap 8.3); a verify-before-switch flow would hook in here.
      await query(
        `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2`,
        [email, identity.userId],
        client,
      );
      // Product decision: revoke every session after an email change so the
      // account must re-authenticate with the new address. In the self-service
      // path this includes the caller's current session.
      await query(`DELETE FROM session WHERE "userId" = $1`, [identity.userId], client);
    }, pool);
  } catch (error) {
    if (error instanceof DatabaseError && error.code === "23505") {
      // Neutral wording: never reveal whether the address belongs to another user.
      throw new EmailChangeError("This email address is not available.", 409);
    }
    if (error instanceof DatabaseError) {
      throw new EmailChangeError("The service is temporarily unavailable.", 503);
    }
    throw error;
  }

  // Security-sensitive action audit. The address itself is intentionally not
  // logged; only the affected user id and the actor are recorded.
  writeLog("info", "identity.email_changed", { userId: identity.userId, actor: "self" });
}
