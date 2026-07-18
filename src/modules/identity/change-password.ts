import { query, type QueryExecutor } from "@/infrastructure/database";

import { getAuth, type StickerfolioAuth } from "./auth";
import { requireIdentity } from "./session";

export async function changeOwnPassword(
  headers: Headers,
  currentPassword: string,
  newPassword: string,
  auth: StickerfolioAuth = getAuth(),
  executor?: QueryExecutor,
): Promise<void> {
  const identity = await requireIdentity(headers, auth, executor);
  await auth.api.changePassword({
    headers,
    body: { currentPassword, newPassword, revokeOtherSessions: true },
  });
  await query(
    `UPDATE "user" SET "mustChangePassword" = false, "updatedAt" = now() WHERE id = $1`,
    [identity.userId],
    executor,
  );
}
