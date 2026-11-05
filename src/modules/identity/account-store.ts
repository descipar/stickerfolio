import { query, type QueryExecutor } from "@/infrastructure/database";

import { normalizeEmail } from "./email";
import { verifyPassword } from "./password";
import type { UserRole } from "./profiles";

/**
 * Write primitives for the identity tables (`user`, `account`, `session`).
 * Other modules, such as `admin`, call these instead of writing the tables
 * themselves (#125). Callers pass their transaction client; authorization and
 * auditing stay with the calling use case.
 */

export async function verifyAccountPassword(
  userId: string,
  password: string,
  executor?: QueryExecutor,
): Promise<boolean> {
  const account = await query<{ password: string | null }>(
    `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [userId],
    executor,
  );
  const hash = account.rows[0]?.password;
  return Boolean(hash) && (await verifyPassword({ hash: hash!, password }));
}

export async function revokeAllSessions(userId: string, executor?: QueryExecutor): Promise<void> {
  await query(`DELETE FROM session WHERE "userId" = $1`, [userId], executor);
}

/** Returns false when the account does not exist. */
export async function setAccountEmail(
  userId: string,
  email: string,
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query(
    `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2`,
    [normalizeEmail(email), userId],
    executor,
  );
  return result.rowCount === 1;
}

export async function insertCredentialAccount(
  input: { email: string; name: string; passwordHash: string; role: UserRole; mustChangePassword: boolean },
  executor?: QueryExecutor,
): Promise<string> {
  const user = await query<{ id: string }>(
    `INSERT INTO "user" (name, email, "emailVerified", "mustChangePassword", role, status)
     VALUES ($1, $2, true, $3, $4, 'active')
     RETURNING id`,
    [input.name, normalizeEmail(input.email), input.mustChangePassword, input.role],
    executor,
  );
  const userId = user.rows[0]!.id;
  await query(
    `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, 'credential', $2, $3, now(), now())`,
    [userId, userId, input.passwordHash],
    executor,
  );
  return userId;
}

/** Replaces the credential password. Returns false when the account does not exist. */
export async function setAccountPassword(
  userId: string,
  passwordHash: string,
  mustChangePassword: boolean,
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query(
    `UPDATE account SET password = $1, "updatedAt" = now()
      WHERE "userId" = $2 AND "providerId" = 'credential'`,
    [passwordHash, userId],
    executor,
  );
  if (result.rowCount !== 1) return false;
  await query(
    `UPDATE "user" SET "mustChangePassword" = $2, "updatedAt" = now() WHERE id = $1`,
    [userId, mustChangePassword],
    executor,
  );
  return true;
}

export async function setAccountStatus(
  userId: string,
  status: "active" | "suspended",
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query(
    `UPDATE "user" SET status = $1, "updatedAt" = now() WHERE id = $2`,
    [status, userId],
    executor,
  );
  return result.rowCount === 1;
}

export async function setAccountRole(
  userId: string,
  role: UserRole,
  executor?: QueryExecutor,
): Promise<boolean> {
  const result = await query(
    `UPDATE "user" SET role = $1, "updatedAt" = now() WHERE id = $2`,
    [role, userId],
    executor,
  );
  return result.rowCount === 1;
}

/** Locks the account row and returns its login email, or null. */
export async function lockAccountEmail(userId: string, executor?: QueryExecutor): Promise<string | null> {
  const result = await query<{ email: string }>(
    `SELECT email FROM "user" WHERE id = $1 FOR UPDATE`,
    [userId],
    executor,
  );
  return result.rows[0]?.email ?? null;
}

/**
 * Deletes the account. ON DELETE CASCADE foreign keys remove sessions,
 * credentials, and the collector profile with everything that belongs to it.
 */
export async function deleteAccount(userId: string, executor?: QueryExecutor): Promise<boolean> {
  const result = await query(`DELETE FROM "user" WHERE id = $1`, [userId], executor);
  return result.rowCount === 1;
}
