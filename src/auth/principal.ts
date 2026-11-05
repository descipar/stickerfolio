import type { Pool } from "pg";

import { getPool } from "@/infrastructure/database";
import { getCollectorProfileForUser, type CollectorProfile } from "@/modules/collectors";
import { getAccountContext } from "@/modules/identity";
import { createPrincipal, type Principal } from "@/shared/principal";

import { getAuth, type StickerfolioAuth } from "./better-auth";

/**
 * Cookie-session adapter (#126): turns a Better Auth session cookie into a
 * {@link Principal}. Only active accounts produce a principal. An OAuth or
 * job adapter would build the same principal from its own credential.
 */
export async function resolveSessionPrincipal(
  headers: Headers,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<Principal | null> {
  return (await resolveViewer(headers, auth, pool))?.principal ?? null;
}

/** What server-rendered pages need for routing: the principal plus the collector profile. */
export interface Viewer {
  principal: Principal;
  userId: string;
  role: Principal["role"];
  mustChangePassword: boolean;
  collector: CollectorProfile | null;
}

export async function resolveViewer(
  headers: Headers,
  auth: StickerfolioAuth = getAuth(),
  pool: Pool = getPool(),
): Promise<Viewer | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const account = await getAccountContext(session.user.id, pool);
  if (account?.status !== "active") return null;
  const collector = await getCollectorProfileForUser(account.userId, pool);
  const principal = createPrincipal({
    userId: account.userId,
    role: account.role,
    mustChangePassword: account.mustChangePassword,
    collectorId: collector?.id ?? null,
    sessionId: session.session.id,
  });
  return {
    principal,
    userId: principal.userId,
    role: principal.role,
    mustChangePassword: principal.mustChangePassword,
    collector,
  };
}
