import type { Pool, PoolClient } from "pg";

import { getPool, query, withTransaction } from "@/infrastructure/database";
import { writeLog } from "@/infrastructure/observability";

import { hashPassword } from "./password";

export const bootstrapAdminEmail = "admin@stickerfolio.local";
export const bootstrapAdminPassword = "admin123!";
const bootstrapLock = 7_241_865_325;

async function createIfEmpty(client: PoolClient): Promise<{ created: boolean; userId?: string }> {
  await query("SELECT pg_advisory_xact_lock($1)", [bootstrapLock], client);
  const users = await query<{ count: string }>(`SELECT count(*)::text AS count FROM "user"`, [], client);
  if (users.rows[0]?.count !== "0") return { created: false };

  const passwordHash = await hashPassword(bootstrapAdminPassword);
  const user = await query<{ id: string }>(
    `INSERT INTO "user"
       (name, email, "emailVerified", "mustChangePassword", role, status)
     VALUES ($1, $2, true, true, 'admin', 'active')
     RETURNING id`,
    ["Administrator", bootstrapAdminEmail],
    client,
  );
  const userId = user.rows[0]!.id;
  await query(
    `INSERT INTO account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
     VALUES ($1, 'credential', $1, $2, now(), now())`,
    [userId, passwordHash],
    client,
  );
  return { created: true, userId };
}

export async function bootstrapInitialAdmin(pool: Pool = getPool()): Promise<boolean> {
  const result = await withTransaction(createIfEmpty, pool);
  if (result.created) writeLog("info", "identity.bootstrap_admin_created", { userId: result.userId });
  return result.created;
}
