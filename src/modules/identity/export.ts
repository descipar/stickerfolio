import { query, type QueryExecutor } from "@/infrastructure/database";

import type { UserRole } from "./profiles";

/** The identity module's part of the portable account export (#125). */
export interface AccountRecordExport {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role: UserRole;
  status: "active" | "suspended";
  passwordChangeRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function exportAccountRecord(
  userId: string,
  executor?: QueryExecutor,
): Promise<AccountRecordExport | null> {
  const result = await query<{
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    image: string | null;
    role: UserRole;
    status: "active" | "suspended";
    must_change_password: boolean;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, "emailVerified" AS email_verified, image, role, status,
            "mustChangePassword" AS must_change_password,
            "createdAt" AS created_at, "updatedAt" AS updated_at
       FROM "user" WHERE id = $1`,
    [userId],
    executor,
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    emailVerified: row.email_verified,
    image: row.image,
    role: row.role,
    status: row.status,
    passwordChangeRequired: row.must_change_password,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
