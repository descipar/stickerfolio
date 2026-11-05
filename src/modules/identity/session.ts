import type { QueryExecutor } from "@/infrastructure/database";

import { getAuth, type StickerfolioAuth } from "./auth";
import { getIdentityContext, type IdentityContext } from "./profiles";

export class AuthenticationError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 = 401,
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function resolveIdentity(
  headers: Headers,
  auth: StickerfolioAuth = getAuth(),
  executor?: QueryExecutor,
): Promise<IdentityContext | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const identity = await getIdentityContext(session.user.id, executor);
  return identity?.status === "active" ? identity : null;
}

/** Like {@link requireIdentity}, plus the id of the session that authenticated the request. */
export async function requireIdentitySession(
  headers: Headers,
  auth: StickerfolioAuth = getAuth(),
  executor?: QueryExecutor,
): Promise<{ identity: IdentityContext; sessionId: string }> {
  const session = await auth.api.getSession({ headers });
  const identity = session ? await getIdentityContext(session.user.id, executor) : null;
  if (!session || identity?.status !== "active") throw new AuthenticationError("Authentication required.");
  return { identity, sessionId: session.session.id };
}

export async function requireIdentity(
  headers: Headers,
  auth?: StickerfolioAuth,
  executor?: QueryExecutor,
): Promise<IdentityContext> {
  const identity = await resolveIdentity(headers, auth, executor);
  if (!identity) throw new AuthenticationError("Authentication required.");
  return identity;
}

export async function requireCollector(
  headers: Headers,
  auth?: StickerfolioAuth,
  executor?: QueryExecutor,
): Promise<IdentityContext & { collector: NonNullable<IdentityContext["collector"]> }> {
  const identity = await requireIdentity(headers, auth, executor);
  if (identity.mustChangePassword) throw new AuthenticationError("Password change required.", 403);
  if (!identity.collector) throw new AuthenticationError("Collector profile required.", 403);
  return identity as IdentityContext & { collector: NonNullable<IdentityContext["collector"]> };
}
