import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";
import {
  hashPassword,
  requireIdentity,
  type IdentityContext,
  type StickerfolioAuth,
  type UserRole,
} from "@/modules/identity";

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 401 | 403 | 404 | 409 = 400,
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

async function requireAdmin(
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
    [input.displayName, input.email.toLowerCase(), input.role],
    client,
  );
  const userId = user.rows[0]!.id;
  await query(
    `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, 'credential', $1, $2, now(), now())`,
    [userId, passwordHash],
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
  const passwordHash = await hashPassword(input.initialPassword);
  try {
    const id = await withTransaction((client) => insertManagedUser(client, input, passwordHash), pool);
    return { id };
  } catch {
    throw new AdminError("The account could not be created.", 409);
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
