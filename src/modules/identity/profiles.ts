import { query, type QueryExecutor } from "@/infrastructure/database";
import type { PrincipalRole } from "@/shared/principal";

export type UserRole = PrincipalRole;

export interface AccountContext {
  userId: string;
  role: UserRole;
  status: "active" | "suspended";
  mustChangePassword: boolean;
}

/** Role, status, and password state of an account. Collector data lives in `collectors`. */
export async function getAccountContext(
  userId: string,
  executor?: QueryExecutor,
): Promise<AccountContext | null> {
  const result = await query<{
    id: string;
    role: UserRole;
    status: "active" | "suspended";
    must_change_password: boolean;
  }>(
    `SELECT id, role, status, "mustChangePassword" AS must_change_password
       FROM "user" WHERE id = $1`,
    [userId],
    executor,
  );
  const row = result.rows[0];
  return row
    ? { userId: row.id, role: row.role, status: row.status, mustChangePassword: row.must_change_password }
    : null;
}

export async function isActiveAccount(userId: string, executor?: QueryExecutor): Promise<boolean> {
  return (await getAccountContext(userId, executor))?.status === "active";
}
