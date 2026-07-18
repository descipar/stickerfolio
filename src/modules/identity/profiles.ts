import { query, type QueryExecutor } from "@/infrastructure/database";

export type UserRole = "user" | "admin";

export interface IdentityContext {
  userId: string;
  role: UserRole;
  status: "active" | "suspended";
  mustChangePassword: boolean;
  collector: null | { id: string; displayName: string };
}

export async function getIdentityContext(
  userId: string,
  executor?: QueryExecutor,
): Promise<IdentityContext | null> {
  const result = await query<{
    user_id: string;
    role: UserRole;
    status: "active" | "suspended";
    must_change_password: boolean;
    collector_id: string | null;
    display_name: string | null;
  }>(
    `SELECT u.id AS user_id, u.role, u.status,
            u."mustChangePassword" AS must_change_password,
            cp.id AS collector_id, cp.display_name
       FROM "user" u
       LEFT JOIN collector_profiles cp ON cp.user_id = u.id
      WHERE u.id = $1`,
    [userId],
    executor,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    mustChangePassword: row.must_change_password,
    collector: row.collector_id
      ? { id: row.collector_id, displayName: row.display_name! }
      : null,
  };
}

export async function createCollectorProfileForUser(
  userId: string,
  displayName: string,
  executor?: QueryExecutor,
): Promise<{ id: string; displayName: string }> {
  const result = await query<{ id: string; display_name: string }>(
    `INSERT INTO collector_profiles (user_id, display_name)
     VALUES ($1, $2) RETURNING id, display_name`,
    [userId, displayName],
    executor,
  );
  return { id: result.rows[0]!.id, displayName: result.rows[0]!.display_name };
}
