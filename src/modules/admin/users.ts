import type { Pool, PoolClient } from "pg";

import { DatabaseError, getPool, query, withTransaction } from "@/infrastructure/database";
import {
  hashPassword,
  normalizeEmail,
  requireIdentity,
  verifyPassword,
  type IdentityContext,
  type StickerfolioAuth,
  type UserRole,
} from "@/modules/identity";
import { maximumPasswordLength, minimumPasswordLength } from "@/shared/password-policy";

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

export async function requireAdmin(
  headers: Headers,
  auth: StickerfolioAuth | undefined,
  pool: Pool,
): Promise<IdentityContext> {
  const identity = await requireIdentity(headers, auth, pool);
  if (identity.mustChangePassword || identity.role !== "admin") {
    throw new AdminError("Administrator access required.", 403);
  }
  return identity;
}

export async function listManagedUsers(
  headers: Headers,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<ManagedUser[]> {
  await requireAdmin(headers, auth, pool);
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
  headers: Headers,
  email: string,
  currentPassword: string,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  const account = await query<{ password: string | null }>(
    `SELECT password FROM account
      WHERE "userId" = $1 AND "providerId" = 'credential'`,
    [actor.userId],
    pool,
  );
  const passwordHash = account.rows[0]?.password;
  if (!passwordHash || !await verifyPassword({ hash: passwordHash, password: currentPassword })) {
    throw new AdminError("The current password is incorrect.");
  }
  try {
    await query(
      `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2`,
      [normalizeEmail(email), actor.userId],
      pool,
    );
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

/**
 * Administrator changes any user's login email. Normalizes with the shared
 * identity normalization, relies on the unique constraint for an atomic
 * check-and-set (23505 -> 409), and revokes the target user's sessions so they
 * must sign in again with the new address (product decision). Email
 * verification is intentionally disabled in the MVP (Roadmap 8.3), so the new
 * address is effective immediately.
 */
export async function setManagedUserEmail(
  headers: Headers,
  userId: string,
  email: string,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  await requireAdmin(headers, auth, pool);
  const normalized = normalizeEmail(email);
  try {
    await withTransaction(async (client) => {
      const result = await query(
        `UPDATE "user" SET email = $1, "updatedAt" = now() WHERE id = $2`,
        [normalized, userId],
        client,
      );
      if (result.rowCount !== 1) throw new AdminError("User not found.", 404);
      await query(`DELETE FROM session WHERE "userId" = $1`, [userId], client);
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
  const user = await query<{ id: string }>(
    `INSERT INTO "user"
       (name, email, "emailVerified", "mustChangePassword", role, status)
     VALUES ($1, $2, true, true, $3, 'active')
     RETURNING id`,
    [input.displayName, normalizeEmail(input.email), input.role],
    client,
  );
  const userId = user.rows[0]!.id;
  await query(
    `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, 'credential', $2, $3, now(), now())`,
    [userId, userId, passwordHash],
    client,
  );
  await query(
    "INSERT INTO collector_profiles (user_id, display_name) VALUES ($1, $2)",
    [userId, input.displayName],
    client,
  );
  return userId;
}

export async function createManagedUser(
  headers: Headers,
  input: CreateManagedUserInput,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<{ id: string }> {
  await requireAdmin(headers, auth, pool);
  if (input.initialPassword.length < minimumPasswordLength || input.initialPassword.length > maximumPasswordLength) {
    throw new AdminError(`Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`);
  }
  const passwordHash = await hashPassword(input.initialPassword);
  try {
    const id = await withTransaction((client) => insertManagedUser(client, input, passwordHash), pool);
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
  headers: Headers,
  userId: string,
  newPassword: string,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  if (actor.userId === userId) throw new AdminError("Use the account password page for your own password.");
  if (newPassword.length < minimumPasswordLength || newPassword.length > maximumPasswordLength) {
    throw new AdminError(`Passwords must contain ${minimumPasswordLength} through ${maximumPasswordLength} characters.`);
  }
  const passwordHash = await hashPassword(newPassword);
  await withTransaction(async (client) => {
    const result = await query(
      `UPDATE account SET password = $1, "updatedAt" = now()
        WHERE "userId" = $2 AND "providerId" = 'credential'`,
      [passwordHash, userId],
      client,
    );
    if (result.rowCount !== 1) throw new AdminError("User not found.", 404);
    await query(
      `UPDATE "user" SET "mustChangePassword" = true, "updatedAt" = now() WHERE id = $1`,
      [userId],
      client,
    );
    await query(`DELETE FROM session WHERE "userId" = $1`, [userId], client);
  }, pool);
}

export async function setManagedUserStatus(
  headers: Headers,
  userId: string,
  status: UserStatus,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  if (actor.userId === userId && status === "suspended") {
    throw new AdminError("Administrators cannot suspend their own account.");
  }
  await withTransaction(async (client) => {
    const result = await query(
      `UPDATE "user" SET status = $1, "updatedAt" = now() WHERE id = $2`,
      [status, userId],
      client,
    );
    if (result.rowCount !== 1) throw new AdminError("User not found.", 404);
    if (status === "suspended") {
      await query(`DELETE FROM session WHERE "userId" = $1`, [userId], client);
    }
  }, pool);
}

export async function setManagedUserRole(
  headers: Headers,
  userId: string,
  role: UserRole,
  auth?: StickerfolioAuth,
  pool: Pool = getPool(),
): Promise<void> {
  const actor = await requireAdmin(headers, auth, pool);
  if (actor.userId === userId && role !== "admin") {
    throw new AdminError("Administrators cannot remove their own administrator role.");
  }
  const result = await query(
    `UPDATE "user" SET role = $1, "updatedAt" = now() WHERE id = $2`,
    [role, userId],
    pool,
  );
  if (result.rowCount !== 1) throw new AdminError("User not found.", 404);
}
